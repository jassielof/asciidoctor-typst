/**
 * References to document information: authors (`{lastname_2}`, `{authors}`), revision (`{revnumber}`, `{version-label}`), language (`{lang}`) and document type (`{doctype}`).
 *
 * Asciidoctor replaces them with their value while parsing. That would freeze the values into the Typst text, so changing one on the Typst side (the `authors:` / `revision:` / `lang:` argument of the document wrapper, or the matching `set-*` function) would leave every reference stale. Instead they become lookups in the template's states:
 *
 *   {lastname_2}   ->  #author-field(n: 2, field: "lastname")
 *   {authors}      ->  #author-names()
 *   {revnumber}    ->  #revision-field("number")
 *   {version-label}->  #revision-field("label")
 *   {lang}         ->  #document-lang()
 *   {doctype}      ->  #document-doctype()
 *
 * Interception happens in `AbstractNode.prototype.subAttributes`, the one place Asciidoctor resolves references, so it applies everywhere it would (paragraphs, titles, list items, table cells, attribute values, included files) and not where it would not (verbatim blocks). The patch is only active inside `withInfoReferences`, so other users of the library in the same process are not affected.
 *
 * A reference is replaced by a placeholder made of private-use characters. The inline renderer turns placeholders in *content* into the lookups above. A placeholder that ends up inside a Typst string (a URL, an alt text, the `attributes` dictionary, a YAML file) cannot hold a lookup, so `resolveLiterals` replaces it with the current value there.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { AbstractNode } from "@asciidoctor/core";
import { str } from "./escape.ts";

const OPEN = "";
const SEP = "";
const CLOSE = "";

/** Matches a placeholder: field name, then the 1-based author index (empty when not per author). */
export const PLACEHOLDER = new RegExp(`${OPEN}([a-z]+)${SEP}(\\d*)${CLOSE}`, "g");

export type AuthorField = "name" | "firstname" | "middlename" | "lastname" | "initials" | "email";

/** The revision keys the template receives (`revision:`), and the language and document type. */
export interface DocumentInfo {
  authors: Array<Partial<Record<AuthorField, string>>>;
  revision: { number?: string; date?: string; remark?: string; label?: string };
  lang?: string;
  doctype?: string;
}

const PER_AUTHOR: Record<string, AuthorField> = {
  author: "name",
  firstname: "firstname",
  middlename: "middlename",
  lastname: "lastname",
  authorinitials: "initials",
  email: "email",
};

/** Placeholder field names of the non-author references, by attribute name. */
const SINGLE: Record<string, string> = {
  authors: "authors",
  authorcount: "count",
  revnumber: "revnumber",
  revdate: "revdate",
  revremark: "revremark",
  "version-label": "revlabel",
  lang: "lang",
  doctype: "doctype",
};

interface Reference {
  field: string;
  /** 1-based author index; 0 when the reference is not per author. */
  n: number;
}

/** The reference an attribute name stands for, or null if it is not document information. */
function referenceFor(attribute: string): Reference | null {
  const single = SINGLE[attribute];
  if (single) return { field: single, n: 0 };
  const m = /^(author|firstname|middlename|lastname|authorinitials|email)(?:_(\d+))?$/.exec(attribute);
  if (!m) return null;
  return { field: PER_AUTHOR[m[1]!]!, n: m[2] ? Number(m[2]) : 1 };
}

const placeholder = (r: Reference) => `${OPEN}${r.field}${SEP}${r.n || ""}${CLOSE}`;

// ------------------------------------------------------------------ interception

/** Per conversion: the attribute names referenced anywhere in the document (`{name}`). */
interface Scope {
  referenced: Set<string>;
}

const active = new AsyncLocalStorage<Scope>();
let installed = false;

type Substitute = (
  this: { document: { attributes: Record<string, unknown> } },
  text: string,
  opts?: object,
) => string;

function install(): void {
  if (installed) return;
  installed = true;
  const proto = AbstractNode.prototype as unknown as { subAttributes: Substitute };
  const original = proto.subAttributes;
  proto.subAttributes = function (text, opts) {
    const scope = active.getStore();
    if (scope && typeof text === "string" && text.includes("{")) {
      // Every reference counts, including the reader's (`ifeval`, include targets).
      for (const m of text.matchAll(/(?<!\\)\{([\p{L}\p{N}_][\p{L}\p{N}_-]*)\}/gu)) {
        scope.referenced.add(m[1]!.toLowerCase());
      }
    }
    // Calls that pass options are the reader's (include targets, `ifeval`): keep real values.
    const plain = !opts || Object.keys(opts).length === 0;
    if (plain && typeof text === "string" && text.includes("{") && scope) {
      const attributes = this.document.attributes;
      text = text.replace(
        /(\\)?\{([\p{L}\p{N}_][\p{L}\p{N}_-]*)\}/gu,
        (match, escaped: string | undefined, name: string) => {
          if (escaped) return match;
          const key = name.toLowerCase();
          const ref = referenceFor(key);
          // Only references to attributes the document actually defines are intercepted.
          return ref && Object.hasOwn(attributes, key) ? placeholder(ref) : match;
        },
      );
    }
    return original.call(this, text, opts);
  };
}

/** Runs `fn` (loading and converting a document) with information references intercepted. */
export function withInfoReferences<T>(fn: () => Promise<T>): Promise<T> {
  install();
  return active.run({ referenced: new Set() }, fn);
}

/**
 * The attribute names referenced so far in the current conversion. Complete once the document has been emitted: paragraphs are substituted lazily, when their content is read.
 */
export function referencedAttributes(): ReadonlySet<string> {
  return active.getStore()?.referenced ?? new Set();
}

// ------------------------------------------------------------------ resolution

const REVISION_KEY: Record<string, string> = {
  revnumber: "number",
  revdate: "date",
  revremark: "remark",
  revlabel: "label",
};

/** The Typst call that reads a placeholder's value from the template's states. */
export function referenceCode(field: string, n: number): string {
  if (field === "authors") return "#author-names()";
  if (field === "count") return "#author-count()";
  if (field === "lang") return "#document-lang()";
  if (field === "doctype") return "#document-doctype()";
  const revision = REVISION_KEY[field];
  if (revision) return `#revision-field(${str(revision)})`;
  const args: string[] = [];
  if (n !== 1) args.push(`n: ${n}`);
  if (field !== "name") args.push(`field: ${str(field)}`);
  return `#author-field(${args.join(", ")})`;
}

/** The information as the template receives it. Set once the document has been loaded. */
let info: DocumentInfo = { authors: [], revision: {} };

export function setDocumentInfo(value: DocumentInfo): void {
  info = value;
}

/** The current value of a placeholder, for contexts that cannot hold a lookup. */
export function literalFor(field: string, n: number): string {
  switch (field) {
    case "authors":
      return info.authors
        .map((a) => a.name ?? "")
        .filter(Boolean)
        .join(", ");
    case "count":
      return String(info.authors.length);
    case "lang":
      return info.lang ?? "";
    case "doctype":
      return info.doctype ?? "";
    default:
      break;
  }
  const revision = REVISION_KEY[field];
  if (revision) return info.revision[revision as keyof DocumentInfo["revision"]] ?? "";
  return info.authors[n - 1]?.[field as AuthorField] ?? "";
}

/**
 * Replaces placeholders left in generated text (they sit inside Typst strings or YAML double-quoted scalars) with their values, escaped for those string forms.
 */
export function resolveLiterals(text: string): string {
  if (!text.includes(OPEN)) return text;
  return text.replace(PLACEHOLDER, (_m, field: string, n: string) =>
    str(literalFor(field, Number(n) || 0)).slice(1, -1),
  );
}
