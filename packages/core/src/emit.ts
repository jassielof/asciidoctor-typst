/**
 * Typst emitter: walks the Asciidoctor AST and writes Typst source.
 *
 * Native Typst constructs are used wherever one exists (headings, lists, term lists, tables, figures, links, footnotes, quotes, raw). Constructs without a Typst equivalent call small `adoc-*` functions defined by the template library, which is where styling happens.
 */
import { escapeMarkup, escapeLineStarts, indent, labelName, str, decodeEntities } from "./escape.ts";
import {
  contentParts,
  contentText,
  dlistEntries,
  type AdocAuthor,
  type AdocDocument,
  type AdocNode,
} from "./ast.ts";
import type { AssetBundle, OutputFile } from "./assets.ts";
import { ASCIIMATH_UNSUPPORTED, UnsupportedSyntaxError } from "./errors.ts";
import { usesTypstMath } from "./math.ts";
import { setDocumentInfo, type AuthorField } from "./info-refs.ts";
import { buildBibSection, toHayagriva, type BibSection } from "./bibliography.ts";
import { dimension, extractCallouts, plainText, renderInline, setCitable, setUnlabelled } from "./inline.ts";

export interface EmitOptions {
  /** Import path of the template library, e.g. `template/lib.typ`. */
  lib: string;
  doctype: "book" | "article";
  /** Header attributes passed to the template. */
  attributes: Record<string, string>;
  /** Collects the images the document refers to. */
  assets: AssetBundle;
  warn(message: string, node?: AdocNode): void;
}

const SPECIAL = new Set(["glossary", "appendix", "index", "partintro", "synopsis"]);

/** Special sections the template draws with a function of `lib/sections.typ`, heading included (so they carry no label of their own). */
/**
 * Special sections that exist only in books (https://docs.asciidoctor.org/asciidoc/latest/sections/styles/). In an article they are reported and written as ordinary sections.
 */
const BOOK_ONLY_SECTIONS = new Set(["colophon", "dedication", "acknowledgments", "preface"]);
const SECTION_FUNCTIONS = BOOK_ONLY_SECTIONS;

type SectionFunction = "colophon" | "dedication" | "acknowledgments" | "preface";

/** Where a top-level block belongs in the document: the template switches mode with `#show: main-matter` and `#show: back-matter`. */
type Matter = "front" | "main" | "back";
const FRONT_MATTER = new Set(["abstract", "dedication", "acknowledgments", "preface"]);
const BACK_MATTER = new Set(["appendix", "glossary", "bibliography", "index", "colophon"]);

const ADMONITIONS = new Set(["note", "tip", "important", "warning", "caution"]);

/**
 * Attributes that are not repeated in the `attributes` dictionary: those with their own wrapper argument (`revision`, `logo`, `lang`), the one the wrapper itself says (`doctype`), and those that mean nothing for Typst (`source-highlighter`, `stem`).
 */
const STRUCTURED_ATTRIBUTES = new Set([
  "version-label",
  "title-logo-image",
  "lang",
  "doctype",
  "source-highlighter",
  "stem",
]);

/**
 * `authorinitials` as defined by the AsciiDoc docs: the first character of the first, middle and last name, up to three. Asciidoctor derives them for the author line but not for an author given by attributes; the template derives them the same way (`parse-author`), so the value used where a lookup is impossible matches what the lookup would give.
 */
function deriveInitials(a: AdocAuthor): string | undefined {
  const parts = [a.getFirstName(), a.getMiddleName(), a.getLastName()].filter((p): p is string => !!p);
  const initials = parts.map((p) => [...p][0]!).join("");
  return initials === "" ? undefined : initials.slice(0, 3);
}

/**
 * The author's name as it is written on the author line: words separated by spaces, and `_` joining the words of one name (`Ovando_F.`). Asciidoctor has already turned those underscores into spaces, which would make `Jassiel Ovando F.` split into three names on the Typst side; the parts it derived tell where the words were joined. The template derives first, middle and last name and the initials from this form, by the same rules.
 */
function writtenName(a: AdocAuthor): string {
  const parts = [a.getFirstName(), a.getMiddleName(), a.getLastName()].filter((p): p is string => !!p);
  if (parts.length === 0) return a.getName();
  return parts.map((p) => p.trim().replace(/\s+/g, "_")).join(" ");
}
/** Parses the attribute list of an inline macro: `alt, key=value, key="quoted value"`. */
function parseMacroAttributes(src: string): { positional: string[]; named: Record<string, string> } {
  const positional: string[] = [];
  const named: Record<string, string> = {};
  for (const part of src.match(/(?:[^,"]|"[^"]*")+/g) ?? []) {
    const token = part.trim();
    if (token === "") continue;
    const m = /^([A-Za-z][\w-]*)\s*=\s*(.*)$/.exec(token);
    const unquote = (v: string) => v.replace(/^"(.*)"$/, "$1");
    if (m) named[m[1]!.toLowerCase()] = unquote(m[2]!.trim());
    else positional.push(unquote(token));
  }
  return { positional, named };
}

export class TypstEmitter {
  private hasParts = false;
  /** Bibliography sections whose entries are exported as Hayagriva. */
  private bibSections = new Map<AdocNode, BibSection>();
  /** The generated Hayagriva documents, in document order. */
  readonly bibliographies: string[] = [];
  /** Generated files other than `main.typ` (the Hayagriva YAML). */
  readonly files: OutputFile[] = [];

  constructor(
    private doc: AdocDocument,
    private o: EmitOptions,
  ) {}

  // ------------------------------------------------------------ helpers

  private inline(s: string | null | undefined, opts: { colons?: boolean } = {}): string {
    if (!s) return "";
    return escapeLineStarts(renderInline(s, opts));
  }

  private list<T>(v: T[] | undefined | null): T[] {
    return Array.isArray(v) ? v : [];
  }

  private roles(node: AdocNode): string[] {
    const r = node.role;
    if (!r) return [];
    return Array.isArray(r) ? r : String(r).split(/\s+/).filter(Boolean);
  }

  /**
   * Bundles an image and returns the path to load it from, relative to `main.typ` (`imagesdir` applied by Asciidoctor); `null` for remote images.
   */
  private async bundleImage(node: AdocNode, target: string): Promise<string | null> {
    return this.o.assets.image(await node.imageUri(target));
  }

  // ------------------------------------------------------------ document

  async emit(): Promise<string> {
    const doc = this.doc;
    this.hasParts = this.o.doctype === "book" && this.containsPart(doc);
    this.collectBibliographies(doc);
    this.collectUnlabelled(doc);
    setDocumentInfo({
      authors: this.authorRecords(),
      revision: this.revisionRecord(),
      lang: this.o.attributes.lang,
      doctype: this.o.doctype,
    });
    const parts: string[] = [];
    parts.push("// Generated by asciidoctor-typst. Edit the AsciiDoc source, not this file.");
    parts.push(`#import ${str(this.o.lib)}: *`);

    // ---- header
    const args: string[] = [`doctype: ${str(this.o.doctype)}`];
    const t = doc.getDocumentTitle({ partition: true });
    let main: string | undefined;
    let sub: string | undefined;
    if (t && typeof t === "object") {
      main = t.main ?? undefined;
      sub = t.subtitle ?? undefined;
    } else if (typeof t === "string") main = t;
    args.push(`title: ${main ? `[${this.inline(main)}]` : "none"}`);
    if (sub) args.push(`subtitle: [${this.inline(sub)}]`);

    args.push(`authors: ${this.authorsArg()}`);
    const revision = this.revisionArg();
    if (revision) args.push(`revision: ${revision}`);
    const logo = await this.logoArg();
    if (logo) args.push(`logo: ${logo}`);
    // The document type and the language are arguments of the settings; like the revision and the logo they are available to the template as states.
    if (this.o.attributes.lang) args.push(`lang: ${str(this.o.attributes.lang)}`);

    args.push(`parts: ${this.hasParts}`);
    // Attributes that already have a structured argument are not repeated here.
    const attrEntries = Object.entries(this.o.attributes)
      .filter(([k]) => !STRUCTURED_ATTRIBUTES.has(k))
      .map(([k, v]) => `${str(k)}: ${str(v)}`);
    args.push(`attributes: (${attrEntries.length ? attrEntries.join(", ") : ":"})`);
    parts.push(`#show: settings.with(\n${args.map((a) => "  " + a + ",").join("\n")}\n)`);

    parts.push(await this.bodyWithMatter(this.list(doc.blocks)));
    return parts.join("\n\n") + "\n";
  }

  /**
   * Authors as derived by Asciidoctor from the author line (one or many) or the author attributes (one). Each entry carries the same parts the `{firstname_2}`-style attributes do. They are the data behind the template's authors state: references in the text become lookups into it (see `info-refs.ts`), so editing the authors in Typst updates them all.
   */
  private authorRecords(): Array<Partial<Record<AuthorField, string>>> {
    return this.doc.getAuthors().map((a) => {
      const fields: Array<[AuthorField, string | undefined]> = [
        ["name", a.getName()],
        ["firstname", a.getFirstName()],
        ["middlename", a.getMiddleName()],
        ["lastname", a.getLastName()],
        ["initials", a.getInitials() || deriveInitials(a)],
        ["email", a.getEmail()],
      ];
      return Object.fromEntries(fields.filter((f): f is [AuthorField, string] => !!f[1]));
    });
  }

  private authorsArg(): string {
    const authors = this.doc.getAuthors().map((a) => {
      const fields = [`name: ${str(writtenName(a))}`];
      const email = a.getEmail();
      if (email) fields.push(`email: ${str(email)}`);
      return `(${fields.join(", ")}),`;
    });
    return authors.length === 0 ? "()" : `(\n${authors.map((a) => `    ${a}`).join("\n")}\n  )`;
  }

  /**
   * Revision information: `revnumber`, `revdate`, `revremark`, plus the `version-label` that prefixes the number. Absent when the document has none of the three.
   */
  private revisionRecord(): { number?: string; date?: string; remark?: string; label?: string } {
    const doc = this.doc;
    const fields: Array<[string, string | undefined]> = [
      ["number", doc.getRevisionNumber()],
      ["date", doc.getRevisionDate()],
      ["remark", doc.getRevisionRemark()],
    ];
    const present = fields.filter((f): f is [string, string] => f[1] !== undefined && f[1] !== "");
    if (present.length === 0) return {};
    const label = doc.getAttribute("version-label");
    if (typeof label === "string" && label !== "") present.push(["label", label]);
    return Object.fromEntries(present);
  }

  private revisionArg(): string | null {
    const present = Object.entries(this.revisionRecord());
    if (present.length === 0) return null;
    return `(\n${present.map(([k, v]) => `    ${k}: ${str(v)},`).join("\n")}\n  )`;
  }

  /**
   * The title page image (an `image(...)` call plus its alignment), from `:title-logo-image:` (`image:path[pdfwidth=25%]` or a bare path, as Asciidoctor PDF accepts). The image is bundled into the output directory.
   */
  private async logoArg(): Promise<string | null> {
    const raw = this.doc.getAttribute("title-logo-image");
    if (typeof raw !== "string" || raw.trim() === "") return null;
    const macro = /^image:+([^[]*)\[(.*)\]$/.exec(raw.trim());
    const target = (macro ? macro[1]! : raw).trim();
    const attrs = parseMacroAttributes(macro ? macro[2]! : "");

    const path = await this.bundleImage(this.doc, target);
    if (path === null) {
      this.o.warn(`title logo must be a local file, remote images are not supported: ${target}`);
      return null;
    }
    // The image is built here, in the document: Typst resolves a path relative to the file that calls `image`, so a bare path handed to the template would be looked up next to it.
    const imageArgs = [str(path)];
    const alt = attrs.named.alt ?? attrs.positional[0];
    if (alt) imageArgs.push(`alt: ${str(alt)}`);
    const width = dimension(attrs.named.pdfwidth ?? attrs.named.width ?? attrs.named.scaledwidth);
    if (width) imageArgs.push(`width: ${width}`);
    const fields = [`image: image(${imageArgs.join(", ")})`];
    const align = attrs.named.align;
    if (align === "left" || align === "center" || align === "right") fields.push(`align: ${align}`);
    return `(${fields.join(", ")})`;
  }

  /** The section function that draws `s`, when it is a book-only special section in a book. */
  private functionSection(s: AdocNode): SectionFunction | null {
    const name: string = s.sectname;
    return this.o.doctype === "book" && SECTION_FUNCTIONS.has(name) ? (name as SectionFunction) : null;
  }

  private isAbstract(b: AdocNode): boolean {
    if (b.context === "section") return b.sectname === "abstract" || b.attributes?.style === "abstract";
    return b.context === "open" && b.style === "abstract";
  }

  /** The matter a top-level block is written for, from its section style. Anything unrecognised is main matter. */
  private matterOf(b: AdocNode): Matter {
    if (this.isAbstract(b)) return "front";
    if (b.context !== "section") return "main";
    if (this.bibSections.has(b)) return "back";
    const name: string = b.sectname;
    // Book-only styles in an article are ordinary sections.
    if (this.o.doctype === "article" && BOOK_ONLY_SECTIONS.has(name)) return "main";
    if (FRONT_MATTER.has(name)) return "front";
    if (BACK_MATTER.has(name)) return "back";
    return "main";
  }

  /**
   * The document body with the template's matter switches. The document starts as front matter (the title page and the abstract, dedication, preface, …); the first block of anything else starts the main matter, and what follows the last main block (appendix, glossary, bibliography, index, colophon) is the back matter.
   */
  private async bodyWithMatter(blocks: AdocNode[]): Promise<string> {
    // The preamble (what precedes the first section) in an article is wrapped in `#preamble`. Any abstract stays in front matter; in a book, pre-section content is unpacked into individual blocks.
    const flat: AdocNode[] = [];
    for (const b of blocks) {
      if (b.context === "preamble") {
        const children = this.list<AdocNode>(b.blocks);
        const abstracts = children.filter((c) => this.isAbstract(c));
        const nonAbstracts = children.filter((c) => !this.isAbstract(c));
        if (abstracts.length > 0) flat.push(...abstracts);
        if (nonAbstracts.length > 0) {
          if (this.o.doctype === "article") {
            const copy = Object.create(b) as AdocNode;
            copy.blocks = nonAbstracts;
            flat.push(copy);
          } else {
            flat.push(...nonAbstracts);
          }
        }
      } else {
        flat.push(b);
      }
    }
    const matters = flat.map((b) => this.matterOf(b));
    // The front matter is the leading run of front sections, the back matter what follows the last main block: a colophon written before the chapters does not turn the chapters into back matter.
    const firstNonFront = matters.findIndex((m) => m !== "front");
    const lastMain = matters.lastIndexOf("main");
    const segments: Array<{ matter: Matter; blocks: AdocNode[] }> = [{ matter: "front", blocks: [] }];
    flat.forEach((b, i) => {
      const phase: Matter =
        firstNonFront === -1 || i < firstNonFront ? "front" : i <= lastMain ? "main" : "back";
      const last = segments[segments.length - 1]!;
      if (last.matter === phase) last.blocks.push(b);
      else segments.push({ matter: phase, blocks: [b] });
    });
    const out: string[] = ["#show: front-matter"];
    let reached: Matter = "front";
    for (const seg of segments) {
      if (seg.matter !== reached) {
        if (reached === "front") out.push("#show: main-matter");
        if (seg.matter === "back") out.push("#show: back-matter");
        reached = seg.matter;
      }
      const text = await this.blocks(seg.blocks);
      if (text) out.push(text);
    }
    return out.join("\n\n");
  }

  private containsPart(node: AdocNode): boolean {
    for (const b of this.list<AdocNode>(node.blocks)) {
      if (b.context === "section" && (b.sectname === "part" || b.level === 0)) return true;
    }
    return false;
  }

  /**
   * Finds `[bibliography]` sections and builds their entries up front, so that citations elsewhere in the document know which keys will exist.
   */
  private collectBibliographies(node: AdocNode): void {
    const citable: string[] = [];
    const visit = (n: AdocNode) => {
      for (const b of this.list<AdocNode>(n.blocks)) {
        if (b.context !== "section") continue;
        if (b.sectname === "bibliography") {
          const sec = buildBibSection(b);
          if (sec) {
            this.bibSections.set(b, sec);
            citable.push(...sec.entries.map((e) => e.key));
          }
        }
        visit(b);
      }
    };
    visit(node);
    setCitable(citable);
  }

  /**
   * Sections drawn by a template function or by `#bibliography` get no label (the function owns the heading); cross references to them must not become dangling links.
   */
  private collectUnlabelled(node: AdocNode): void {
    const ids: string[] = [];
    const visit = (n: AdocNode) => {
      for (const b of this.list<AdocNode>(n.blocks)) {
        if (b.context !== "section") continue;
        const name = b.sectname;
        const abstract = name === "abstract" || b.attributes?.style === "abstract";
        if (b.id && (abstract || this.functionSection(b) || this.bibSections.has(b))) ids.push(b.id);
        visit(b);
      }
    };
    visit(node);
    setUnlabelled(ids);
  }

  /**
   * The `#bibliography(...)` call replacing a bibliography section's heading and entry lists. Typst generates the (translated) title itself, at heading level 1 plus `offset`. The call is emitted bare: no wrapper function and no label.
   */
  private bibliographyCall(sec: BibSection, level: number, title: string): string {
    const yaml = toHayagriva(sec.entries);
    this.bibliographies.push(yaml);
    // One file per bibliography, next to main.typ: bibliography.yaml, bibliography-2.yaml, ...
    const n = this.bibliographies.length;
    const path = n === 1 ? "bibliography.yaml" : `bibliography-${n}.yaml`;
    this.files.push({ path, content: yaml });

    const note = `// asciidoctor-typst: the section title "${title}" is replaced by Typst's generated one`;
    const call = ["#bibliography(", "  full: true,", `  ${str(path)},`, ")"].join("\n");
    // The generated title is a level-1 heading; shift it to the section's level.
    const body = level > 1 ? `#[\n#set heading(offset: ${level - 1})\n${call}\n]` : call;
    return [note, body].join("\n");
  }

  // ------------------------------------------------------------ blocks

  /**
   * `replace` may substitute the output for a block (`""` drops it); used to swap a bibliography's lists for the generated `#bibliography` call.
   */
  private async blocks(blocks: AdocNode[], replace?: (b: AdocNode) => string | undefined): Promise<string> {
    const out: string[] = [];
    let prev = "";
    for (const b of blocks) {
      const s = replace?.(b) ?? (await this.block(b));
      if (s === "") continue;
      // Adjacent lists of the same kind merge in Typst (blank lines and `#[]` do not split them); an inert weak space does.
      const isList = b.context === "ulist" || b.context === "olist" || b.context === "dlist";
      if (isList && prev === b.context && !b.title && out.length > 0) out.push("#v(0pt, weak: true)");
      out.push(s);
      prev = b.context;
    }
    return out.join("\n\n");
  }

  private async block(b: AdocNode): Promise<string> {
    let s = await this.blockCore(b);
    if (s === "") return s;
    const skip = new Set(["section", "thematic_break", "page_break", "toc", "floating_title"]);
    if (!skip.has(b.context)) {
      const roles = this.roles(b);
      if (roles.length > 0) {
        const arr = `(${roles.map(str).join(", ")}${roles.length === 1 ? "," : ""})`;
        s = `#adoc-role(${arr})[\n${s}\n]`;
      }
      if (b.id) s = `#metadata(none)<${labelName(b.id)}>\n${s}`;
    }
    return s;
  }

  private title(b: AdocNode): string | undefined {
    const t = b.hasTitle?.() ? b.title : undefined;
    return t ? this.inline(t) : undefined;
  }

  private withTitle(b: AdocNode, body: string): string {
    const t = this.title(b);
    return t === undefined ? body : `#adoc-block-title[${t}]\n${body}`;
  }

  private figure(expr: string, b: AdocNode): string {
    const title = this.title(b);
    if (title === undefined) return `#${expr}`;
    return `#figure(\n${indent(expr, "  ")},\n  caption: [${title}],\n)`;
  }

  /** Paragraph-ish content (simple content model) or nested blocks (compound). */
  private async content(b: AdocNode): Promise<string> {
    if (b.contentModel === "compound") return this.blocks(this.list(b.blocks));
    const c = await contentText(b);
    return typeof c === "string" ? this.inline(c) : "";
  }

  private async blockCore(b: AdocNode): Promise<string> {
    switch (b.context) {
      case "section":
        return this.section(b);
      case "floating_title": {
        const level = this.headingLevel(b.level);
        const label = b.id ? ` <${labelName(b.id)}>` : "";
        return `#discrete-heading(level: ${level})[${this.inline(b.title)}]${label}`;
      }
      case "preamble": {
        const body = await this.blocks(this.list(b.blocks));
        return body === "" ? "" : `#preamble[\n${indent(body, "  ")}\n]`;
      }
      case "paragraph":
        return this.withTitle(b, this.inline(await contentText(b)));
      case "listing":
        return this.listing(b);
      case "literal": {
        const text = decodeEntities(plainText(await contentText(b)));
        return this.figure(`raw(block: true, ${str(text)})`, b);
      }
      case "example":
      case "sidebar": {
        const t = this.title(b);
        const fn = b.context === "example" ? "adoc-example" : "adoc-sidebar";
        return `#${fn}(${t !== undefined ? `title: [${t}]` : ""})[\n${await this.content(b)}\n]`;
      }
      case "open": {
        const body = await this.content(b);
        const style: string | undefined = b.style ?? undefined;
        if (style === "abstract") {
          return this.sectionCall("abstract", { style: "block", title: this.title(b) }, body);
        }
        if (style === "partintro") {
          return this.withTitle(b, `#adoc-partintro[\n${body}\n]`);
        }
        return this.withTitle(b, body);
      }
      case "admonition": {
        const kind = String(b.getAttribute("name") ?? b.style ?? "note").toLowerCase();
        const t = this.title(b);
        const name = ADMONITIONS.has(kind) ? kind : "note";
        return `#adoc-admonition(${str(name)}${t !== undefined ? `, title: [${t}]` : ""})[\n${await this.content(b)}\n]`;
      }
      case "quote": {
        const a = await this.attribution(b);
        const q = `#quote(block: true${a ? `, attribution: [${a}]` : ""})[\n${await this.content(b)}\n]`;
        return this.withTitle(b, q);
      }
      case "verse": {
        const a = await this.attribution(b);
        const text: string = await contentText(b);
        const lines = text.split("\n").map((l) => this.inline(l));
        const v = `#adoc-verse(${a ? `attribution: [${a}]` : ""})[\n${lines.join(" \\\n")}\n]`;
        return this.withTitle(b, v);
      }
      case "pass": {
        const text = String(await contentText(b));
        if (b.style !== "typst" && /^\s*<[!/a-zA-Z]/.test(text)) {
          this.o.warn("passthrough block looks like HTML and was dropped", b);
          return "";
        }
        return text;
      }
      case "stem": {
        if (usesTypstMath(b) && !/latex/i.test(String(b.style))) {
          return `$ ${plainText(String(await contentText(b))).trim()} $`;
        }
        if (!/latex/i.test(String(b.style))) {
          throw new UnsupportedSyntaxError(ASCIIMATH_UNSUPPORTED, {
            file: b.getFile(),
            line: b.getLineNumber(),
          });
        }
        return `#mitex(${str(plainText(String(await contentText(b))))})`;
      }
      case "ulist":
      case "olist":
        return this.withTitle(b, await this.bulletList(b));
      case "colist": {
        const items: string[] = [];
        for (const it of this.list<AdocNode>(b.items)) items.push(`[${await this.itemContent(it)}]`);
        return this.withTitle(b, `#adoc-callout-list((${items.join(", ")},))`);
      }
      case "dlist":
        return this.withTitle(b, await this.dlist(b));
      case "table":
        return this.table(b);
      case "image":
        return this.imageBlock(b);
      case "video":
      case "audio": {
        this.o.warn(`${b.context} blocks are not supported by Typst; emitted as a link`, b);
        const target = String(b.getAttribute("target") ?? "");
        return `#link(${str(target)})[${this.title(b) ?? escapeMarkup(target)}]`;
      }
      case "thematic_break":
        return "#line(length: 100%)";
      case "page_break":
        return "#pagebreak()";
      case "toc":
        return "#outline()";
      default: {
        this.o.warn(`unsupported block type: ${b.context}`, b);
        if (b.contentModel === "compound") return this.blocks(this.list(b.blocks));
        return "";
      }
    }
  }

  private async attribution(b: AdocNode): Promise<string | undefined> {
    const parts: string[] = [];
    for (const key of ["attribution", "citetitle"]) {
      const v = b.getAttribute(key);
      if (v) parts.push(this.inline(await b.applySubs(String(v))));
    }
    return parts.length ? parts.join(", ") : undefined;
  }

  // ------------------------------------------------------------ sections

  private headingLevel(level: number): number {
    return this.hasParts ? level + 1 : Math.max(level, 1);
  }

  private async section(s: AdocNode): Promise<string> {
    const level = this.headingLevel(s.level);
    const title = this.inline(s.title);
    const label = s.id ? ` <${labelName(s.id)}>` : "";
    // A bibliography's heading is generated by Typst's `#bibliography`, not written here.
    const bib = this.bibSections.get(s);
    const name: string = s.sectname;
    if (this.o.doctype === "article" && BOOK_ONLY_SECTIONS.has(name)) {
      this.o.warn(
        `[${name}] sections only exist in books; "${plainText(s.title ?? "")}" is written as an ordinary section`,
        s,
      );
    }
    // These functions draw their own heading, like the abstract.
    const ownHeading = this.functionSection(s) !== null;
    const heading = bib || ownHeading ? "" : `${"=".repeat(level)} ${title}${label}`;
    let placed = false;
    const body = await this.blocks(
      this.list(s.blocks),
      bib
        ? (b) => {
            if (!bib.lists.has(b)) return undefined;
            if (placed) return "";
            placed = true;
            return this.bibliographyCall(bib, level, plainText(s.title ?? ""));
          }
        : undefined,
    );
    const inner = heading && body ? `${heading}\n\n${body}` : heading || body;
    let out = inner;
    // `[abstract]` sections are not wrapped around their heading: the template's `abstract` draws the title itself (https://docs.asciidoctor.org/asciidoc/latest/sections/abstract/). In a book Asciidoctor turns an abstract section into a chapter (sectname `chapter`) but keeps the style the author wrote.
    if (name === "abstract" || s.attributes?.style === "abstract") {
      out = this.sectionCall("abstract", { title: s.title ? this.inline(s.title) : undefined }, body);
    } else if (ownHeading) {
      out = this.sectionCall(name as SectionFunction, { title: this.inline(s.title), level }, body);
    } else if (bib || name === "bibliography") {
      // Bare: the `#bibliography` call (or just the heading) is the whole section.
      out = inner;
    } else if (name && SPECIAL.has(name)) {
      out = `#adoc-${name}[\n${inner}\n]`;
    } else if (s.special && name && name !== "section" && name !== "chapter" && name !== "part") {
      out = `#adoc-special(${str(name)})[\n${inner}\n]`;
    }
    const roles = this.roles(s);
    if (roles.length > 0) {
      const arr = `(${roles.map(str).join(", ")}${roles.length === 1 ? "," : ""})`;
      out = `#adoc-role(${arr})[\n${out}\n]`;
    }
    return out;
  }

  /**
   * A call to one of the template's section functions, `fn(body, title:, style:, level:)` (`abstract`, `colophon`, `dedication`, …). They draw their own heading, so the heading is not part of `body`.
   *
   * - an abstract *section* (`[abstract]` on a heading) is `style: "section"`, the default; an abstract *block* is `style: "block"`.
   * - `level` is the heading level, only passed when it is not 1.
   */
  private sectionCall(
    fn: "abstract" | SectionFunction,
    opts: { style?: "block"; title?: string; level?: number },
    body: string,
  ): string {
    const args: string[] = [];
    if (opts.style) args.push(`style: ${str(opts.style)}`);
    if (opts.title !== undefined) args.push(`title: [${opts.title}]`);
    if (opts.level !== undefined && opts.level > 1) args.push(`level: ${opts.level}`);
    const head = `#${fn}(${args.join(", ")})`;
    return body.includes("\n") ? `${head}[\n${body}\n]` : `${head}[${body}]`;
  }
  // ------------------------------------------------------------ verbatim

  private async listing(b: AdocNode): Promise<string> {
    const { text, callouts } = extractCallouts(String(await contentText(b)));
    const style = b.style;
    let lang: string | undefined = b.getAttribute("language") || undefined;
    if (style !== "source" && !lang) lang = undefined;
    const args: string[] = [];
    if (callouts.length === 0) {
      args.push("block: true");
      if (lang) args.push(`lang: ${str(lang)}`);
      args.push(str(text));
      return this.figure(`raw(${args.join(", ")})`, b);
    }
    if (lang) args.push(`lang: ${str(lang)}`);
    args.push(
      `callouts: (${callouts.map((c) => `(${c.line}, ${c.n})`).join(", ")}${callouts.length === 1 ? "," : ""})`,
    );
    args.push(str(text));
    return this.figure(`adoc-callout-code(${args.join(", ")})`, b);
  }

  // ------------------------------------------------------------ lists

  private async itemContent(item: AdocNode): Promise<string> {
    const text = this.inline(item.text);
    const kids: string[] = [];
    for (const c of this.list<AdocNode>(item.blocks)) {
      const s = await this.block(c);
      if (s) kids.push(s);
    }
    return kids.length ? `${text}\n\n${kids.join("\n\n")}` : text;
  }

  private async itemBody(text: string, children: AdocNode[]): Promise<string> {
    let out = indent(text, "  ").replace(/^ {2}/, "");
    for (const child of children) {
      const s = await this.block(child);
      if (s === "") continue;
      const nested = ["ulist", "olist", "dlist"].includes(child.context);
      out += (nested ? "\n" : "\n\n") + indent(s, "  ");
    }
    return out;
  }

  private async bulletList(b: AdocNode): Promise<string> {
    const lines: string[] = [];
    const ordered = b.context === "olist";
    let numbering: string | undefined;
    if (ordered) {
      switch (b.style) {
        case "loweralpha":
          numbering = "a.";
          break;
        case "upperalpha":
          numbering = "A.";
          break;
        case "lowerroman":
          numbering = "i)";
          break;
        case "upperroman":
          numbering = "I)";
          break;
        default:
          break;
      }
    }
    const startAttr = ordered ? b.getAttribute("start") : undefined;
    const checklist = !ordered && b.hasOption?.("checklist");
    let idx = 0;
    for (const item of this.list<AdocNode>(b.items)) {
      let marker = "- ";
      if (ordered) marker = idx === 0 && startAttr && String(startAttr) !== "1" ? `${startAttr}. ` : "+ ";
      let text = this.inline(item.text);
      if (checklist && item.hasAttribute?.("checkbox")) {
        text = (item.hasAttribute("checked") ? "☑ " : "☐ ") + text;
      }
      lines.push(marker + (await this.itemBody(text, this.list(item.blocks))));
      idx++;
    }
    const body = lines.join("\n");
    if (numbering) return `#[\n#set enum(numbering: ${str(numbering)})\n${body}\n]`;
    return body;
  }

  private async dlist(b: AdocNode): Promise<string> {
    const lines: string[] = [];
    for (const [terms, dd] of dlistEntries(b)) {
      const term = this.list<AdocNode>(terms)
        .map((t) => this.inline(t.text, { colons: true }))
        .join("#linebreak()");
      const desc = dd ? this.inline(dd.text) : "";
      const head = `/ ${term}:${desc ? " " : ""}`;
      lines.push(head + (await this.itemBody(desc, dd ? this.list(dd.blocks) : [])));
    }
    return lines.join("\n");
  }

  // ------------------------------------------------------------ images

  private async imageBlock(b: AdocNode): Promise<string> {
    const target = String(b.getAttribute("target"));
    const alt = decodeEntities(String(b.getAttribute("alt") ?? ""));
    const path = await this.bundleImage(b, target);
    if (path === null) {
      this.o.warn(`remote image is not supported by Typst, emitted as a link: ${target}`, b);
      return `#link(${str(target)})[${escapeMarkup(alt)}]`;
    }
    const args = [str(path), `alt: ${str(alt)}`];
    const w = dimension(
      b.getAttribute("width") ?? b.getAttribute("scaledwidth") ?? b.getAttribute("pdfwidth"),
    );
    const h = dimension(b.getAttribute("height"));
    if (w) args.push(`width: ${w}`);
    if (h) args.push(`height: ${h}`);
    let inner = `image(${args.join(", ")})`;
    const link = b.getAttribute("link");
    if (link) inner = `link(${str(decodeEntities(String(link)))}, ${inner})`;
    const align = b.getAttribute("align");
    if (align === "center" || align === "right" || align === "left") inner = `align(${align}, ${inner})`;
    return this.figure(inner, b);
  }

  // ------------------------------------------------------------ tables

  private async cell(c: AdocNode, inHead: boolean): Promise<string> {
    let body: string;
    const style: string = c.style ?? "none";
    if (style === "asciidoc") {
      const inner = c.getInnerDocument();
      body = inner ? await this.blocks(this.list(inner.blocks)) : "";
    } else if (inHead) {
      body = this.inline(c.text);
    } else if (style === "literal") {
      body = `#raw(block: true, ${str(plainText(String(c.text ?? "")))})`;
    } else {
      const paragraphs = await contentParts(c);
      body = paragraphs.map((p) => this.inline(p)).join("\n\n");
    }
    const args: string[] = [];
    if (c.colspan && c.colspan > 1) args.push(`colspan: ${c.colspan}`);
    if (c.rowspan && c.rowspan > 1) args.push(`rowspan: ${c.rowspan}`);
    // Cells inherit their column's alignment; only state what differs from it.
    const h = c.getAttribute("halign");
    const v = c.getAttribute("valign");
    const colH = c.column?.getAttribute("halign");
    const colV = c.column?.getAttribute("valign");
    const align: string[] = [];
    if (h && h !== "left" && h !== colH) align.push(h);
    if (v && v !== "top" && v !== colV) align.push(v === "middle" ? "horizon" : v);
    if (align.length) args.push(`align: ${align.join(" + ")}`);
    if (style === "header" && !inHead) body = `#strong[${body}]`;
    const content = `[${body}]`;
    return args.length > 0 ? `table.cell(${args.join(", ")})${content}` : content;
  }

  private async table(b: AdocNode): Promise<string> {
    const columns: AdocNode[] = this.list(b.columns);
    const autowidth = b.hasOption?.("autowidth");
    const widths = columns.map((c) => {
      if (autowidth || c.hasOption?.("autowidth")) return "auto";
      const pct = Number(c.getAttribute("colpcwidth"));
      const rel = Number(c.getAttribute("width"));
      return Number.isFinite(rel) && rel > 0 ? `${rel}fr` : Number.isFinite(pct) ? `${pct}%` : "1fr";
    });
    const lines: string[] = [];
    lines.push(`  columns: (${widths.join(", ")}${widths.length === 1 ? "," : ""}),`);
    const aligns = columns.map((c) => c.getAttribute("halign") ?? "left");
    if (aligns.some((a) => a !== "left")) {
      lines.push(`  align: (${aligns.join(", ")}${aligns.length === 1 ? "," : ""}),`);
    }
    if (b.getAttribute("frame") === "none" && b.getAttribute("grid") === "none")
      lines.push("  stroke: none,");

    const rows = b.rows ?? { head: [], body: [], foot: [] };
    const render = async (rs: AdocNode[][], head: boolean) => {
      const out: string[] = [];
      for (const r of rs) {
        const cells: string[] = [];
        for (const c of r) cells.push(await this.cell(c, head));
        out.push(cells.join(", "));
      }
      return out;
    };
    const head = await render(this.list(rows.head), true);
    if (head.length) lines.push(`  table.header(${head.join(", ")}),`);
    for (const r of await render(this.list(rows.body), false)) lines.push(`  ${r},`);
    const foot = await render(this.list(rows.foot), false);
    if (foot.length) lines.push(`  table.footer(${foot.join(", ")}),`);

    if (head.length + foot.length + this.list(rows.body).length === 0) this.o.warn("table has no cells", b);
    let expr = `table(\n${lines.join("\n")}\n)`;
    const width = b.getAttribute("width");
    const w = dimension(width);
    if (w && String(width) !== "100%") expr = `block(width: ${w}, ${expr})`;
    return this.figure(expr, b);
  }
}
