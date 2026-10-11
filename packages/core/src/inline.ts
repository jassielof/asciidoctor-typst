/**
 * Inline conversion: a custom Asciidoctor converter for the `typst` backend.
 *
 * Asciidoctor runs its own inline substitutions (quotes, macros, replacements, ...) and calls the converter for each inline node. Text it produces is HTML-escaped, so converter output cannot simply be concatenated: Typst code must survive the later substitution passes and must not be escaped as text. Converter methods therefore return *tokens* (private-use delimited indexes into a table). `renderInline` splits a converted string back into text segments (entity-decoded and escaped for Typst) and tokens (expanded to Typst code).
 */
import { ConverterBase } from "@asciidoctor/core";
import type { AdocNode } from "./ast.ts";
import { literalFor, PLACEHOLDER, referenceCode } from "./info-refs.ts";
import { ASCIIMATH_UNSUPPORTED, UnsupportedSyntaxError } from "./errors.ts";
import { usesTypstMath } from "./math.ts";
import { decodeEntities, escapeMarkup, labelName, str } from "./escape.ts";

// Tokens are shaped like HTML tags (`<` + private-use char + index + private-use char + `>`) on purpose: Asciidoctor strips tags when it derives section ids from converted titles, so ids come out the same as with any other backend. Real `<` in text is always `&lt;` by then.
const OPEN = "<\ue000";
const CLOSE = "\ue001>";

interface Atom {
  k: "atom";
  code: string;
  /** Whether the code ends with an expression that a following `.`/`(` could extend. */
  expr: boolean;
  /** Plain-text rendition used where markup cannot be kept (e.g. inside `raw`). */
  plain?: string;
  /** Callout number, for callout markers inside verbatim blocks. */
  callout?: number;
  /** Hard line break: must be followed by a newline. */
  hardbreak?: boolean;
  /** Bibliography anchor (`[[[id,reftext]]]`). */
  bib?: { id: string; reftext?: string };
  /** Target of a link, for consumers that need structure rather than markup. */
  href?: string;
}
interface Open {
  k: "open";
  code: string;
  pair: number;
  /** Plain monospace: rendered as `raw` when its content is only text. */
  mono?: boolean;
  /** Cross reference to a bibliography entry; becomes a citation when the entry is exported. */
  cite?: string;
  /** Id a `#link(<id>)` points at; dropped when that id carries no label in the output. */
  anchor?: string;
  href?: string;
}
interface Close {
  k: "close";
  code: string;
  pair: number;
}
type Entry = Atom | Open | Close;

const table: Entry[] = [];
let pairSeq = 0;

function token(e: Entry): string {
  table.push(e);
  return `${OPEN}${table.length - 1}${CLOSE}`;
}

const atom = (code: string, extra: Partial<Atom> = {}): string =>
  token({ k: "atom", code, expr: true, ...extra });

function wrap(open: string, close: string, text: string, extra: Partial<Open> = {}): string {
  const pair = pairSeq++;
  return token({ k: "open", code: open, pair, ...extra }) + text + token({ k: "close", code: close, pair });
}

/**
 * Ids of bibliography entries that are exported to a Hayagriva file. References to them become Typst citations (`@id`); other bibliography anchors stay ordinary links.
 */
let citable = new Set<string>();
export function setCitable(ids: Iterable<string>): void {
  citable = new Set(ids);
}

/**
 * Ids of sections the output draws through a template function (abstract, colophon) or through `#bibliography`, which therefore carry no label. A cross reference to one is plain text.
 */
let unlabelled = new Set<string>();
export function setUnlabelled(ids: Iterable<string>): void {
  unlabelled = new Set(ids);
}

/** Hooks the converter needs from the caller (asset bundling, diagnostics). */
export interface InlineHooks {
  /**
   * Registers an image (URI already joined with `imagesdir`) and returns the path Typst should load, relative to the output directory; `null` if the image is remote.
   */
  bundleImage(uri: string): string | null;
  warn(message: string): void;
}
let hooks: InlineHooks = { bundleImage: (t) => t, warn: () => {} };
export function setInlineHooks(h: InlineHooks): void {
  hooks = h;
}

const callout = (n: string) => atom("", { callout: Number(n), plain: "" });

type TextPart = { t: "text"; v: string };
type TokPart = { t: "tok"; e: Entry };

/**
 * Appends text, turning information-reference placeholders (see `info-refs.ts`) into atoms that read the template's states; `plain` holds the value for plain-text uses.
 */
function pushText(out: Array<TextPart | TokPart>, text: string): void {
  let last = 0;
  for (const m of text.matchAll(PLACEHOLDER)) {
    if (m.index! > last) out.push({ t: "text", v: text.slice(last, m.index) });
    const field = m[1]!;
    const n = Number(m[2]) || 0;
    out.push({
      t: "tok",
      e: { k: "atom", code: referenceCode(field, n), expr: true, plain: literalFor(field, n) },
    });
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push({ t: "text", v: text.slice(last) });
}

function split(s: string): Array<TextPart | TokPart> {
  const out: Array<TextPart | TokPart> = [];
  const re = new RegExp(`${OPEN}(\\d+)${CLOSE}`, "g");
  let last = 0;
  for (const m of s.matchAll(re)) {
    if (m.index! > last) pushText(out, s.slice(last, m.index));
    out.push({ t: "tok", e: table[Number(m[1])]! });
    last = m.index! + m[0].length;
  }
  if (last < s.length) pushText(out, s.slice(last));
  return out;
}

/** Plain text of a converted string: entities decoded, markup dropped. */
export function plainText(s: string): string {
  return split(s)
    .map((p) => (p.t === "text" ? decodeEntities(p.v) : p.e.k === "atom" ? (p.e.plain ?? "") : ""))
    .join("");
}

/**
 * Verbatim text with callout markers removed. Returns the decoded text and, for each marker, the zero-based line it was on.
 */
export function extractCallouts(s: string): { text: string; callouts: Array<{ line: number; n: number }> } {
  const callouts: Array<{ line: number; n: number }> = [];
  let line = 0;
  let out = "";
  let lineHasCallout = false;
  for (const p of split(s)) {
    if (p.t === "text") {
      const decoded = decodeEntities(p.v);
      for (const ch of decoded) {
        if (ch === "\n") {
          line++;
          lineHasCallout = false;
        }
        out += ch;
      }
      if (lineHasCallout) out = out.replace(/[ \t]+$/, "");
    } else if (p.e.k === "atom" && p.e.callout !== undefined) {
      callouts.push({ line, n: p.e.callout });
      lineHasCallout = true;
      out = out.replace(/[ \t]+$/, "");
    }
  }
  // Trim whitespace left before a callout at line end (guards and spacing).
  return { text: out, callouts };
}

/** A run of text from a converted string, with the structure bibliography parsing needs. */
export interface Segment {
  text: string;
  emphasis: boolean;
  href?: string;
}

/**
 * Splits a converted string into text segments that remember emphasis and link targets, and pulls out a leading bibliography anchor if there is one. Used to turn bibliography entries into structured data.
 */
export function entrySegments(s: string): {
  anchor?: { id: string; reftext?: string };
  segments: Segment[];
} {
  const segments: Segment[] = [];
  let anchor: { id: string; reftext?: string } | undefined;
  const open: Array<{ pair: number; emphasis: boolean; href?: string }> = [];
  const emphasis = () => open.some((o) => o.emphasis);
  const href = () => open.findLast((o) => o.href !== undefined)?.href;
  for (const p of split(s)) {
    if (p.t === "text") {
      const text = decodeEntities(p.v);
      if (text !== "") segments.push({ text, emphasis: emphasis(), href: href() });
      continue;
    }
    const e = p.e;
    if (e.k === "atom") {
      if (e.bib && !anchor) anchor = e.bib;
      else if (e.href) segments.push({ text: e.plain ?? e.href, emphasis: emphasis(), href: e.href });
      else if (e.plain) segments.push({ text: e.plain, emphasis: emphasis(), href: href() });
    } else if (e.k === "open") {
      open.push({ pair: e.pair, emphasis: e.code === "#emph[" || e.code === "#strong[", href: e.href });
    } else {
      const at = open.findLastIndex((o) => o.pair === e.pair);
      if (at >= 0) open.splice(at, 1);
    }
  }
  return { anchor, segments };
}

export interface RenderOptions {
  /** Escape `:` too (needed inside term-list terms). */
  colons?: boolean;
}

/** Converts a string produced by Asciidoctor (with converter tokens) into Typst markup. */
export function renderInline(s: string, opts: RenderOptions = {}): string {
  return renderParts(split(s), opts);
}

function renderParts(parts: Array<TextPart | TokPart>, opts: RenderOptions): string {
  let out = "";
  let prevExpr = false;
  // Links to label-less targets: the text stays, the `#link(...)[` and `]` around it go.
  const unlinked = new Set<number>();
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]!;
    if (p.t === "text") {
      let s = escapeMarkup(decodeEntities(p.v), opts.colons);
      // `#f[x].y` is a field access and `#f[x](y)` a further call: keep following text literal.
      if (prevExpr && /^(?:\.[\p{L}_]|[([])/u.test(s)) s = "\\" + s;
      out += s;
      if (s !== "") prevExpr = false;
      continue;
    }
    const e = p.e;
    if (e.k === "atom") {
      out += e.code;
      if (e.hardbreak && !(parts[i + 1]?.t === "text" && (parts[i + 1] as TextPart).v.startsWith("\n")))
        out += "\n";
      if (e.code !== "") prevExpr = e.expr;
    } else if (e.k === "open") {
      if (e.cite !== undefined && citable.has(e.cite)) {
        // The displayed text is dropped: Hayagriva has no per-entry custom labels.
        const close = parts.findIndex(
          (q, j) => j > i && q.t === "tok" && q.e.k === "close" && q.e.pair === e.pair,
        );
        const end = close < 0 ? parts.length : close;
        const id = labelName(e.cite);
        // `@id` is sugar for `#cite(<id>)`; keep the long form where the key would run into following text. A trailing sentence period is fine.
        const next = parts[end + 1];
        const nextText = next?.t === "text" ? decodeEntities(next.v) : "";
        const safe = !/^(?:[\p{L}\p{N}_:-]|\.[\p{L}\p{N}_])/u.test(nextText);
        out += safe ? `@${id}` : `#cite(<${id}>)`;
        prevExpr = !safe;
        i = end;
      } else if (e.mono) {
        const close = parts.findIndex(
          (q, j) => j > i && q.t === "tok" && q.e.k === "close" && q.e.pair === e.pair,
        );
        const end = close < 0 ? parts.length : close;
        const inner = parts.slice(i + 1, end);
        if (inner.every((q) => q.t === "text")) {
          out += `#raw(${str(inner.map((q) => decodeEntities((q as TextPart).v)).join(""))})`;
        } else {
          out += `#adoc-mono[${renderParts(inner, opts)}]`;
        }
        prevExpr = true;
        i = end;
      } else if (e.anchor !== undefined && unlabelled.has(e.anchor)) {
        unlinked.add(e.pair);
      } else {
        out += e.code;
        prevExpr = false;
      }
    } else if (unlinked.has(e.pair)) {
      unlinked.delete(e.pair);
    } else {
      out += e.code;
      prevExpr = true;
    }
  }
  return out;
}

// ------------------------------------------------------------------ converter

const SPAN_ROLE = new Map<string, [string, string]>([
  ["underline", ["#underline[", "]"]],
  ["line-through", ["#strike[", "]"]],
  ["overline", ["#overline[", "]"]],
]);

const PASS_START = "\u0096";

/**
 * Macro targets can contain passthrough placeholders (`link:pass:[a b.pdf][text]`), which Asciidoctor only restores in the final string. Targets are embedded in tokens, so restore them here, using the node that owns the passthrough list.
 */
async function restorePassthroughs(node: AdocNode, s: string): Promise<string> {
  if (!s.includes(PASS_START)) return s;
  const owner = (node as unknown as { parent?: { restorePassthroughs?(t: string): Promise<string> } }).parent;
  return owner?.restorePassthroughs ? owner.restorePassthroughs(s) : s;
}

/** Method provided by Asciidoctor's backend-traits mixin but missing from its typings. */
interface BackendTraits {
  initBackendTraits(traits: Record<string, string | boolean>): void;
}

export class TypstInlineConverter extends ConverterBase {
  constructor(backend: string, opts: object = {}) {
    super(backend, opts);
    (this as unknown as BackendTraits).initBackendTraits({
      basebackend: "typst",
      filetype: "typ",
      outfilesuffix: ".typ",
      supportsTemplates: false,
    });
  }

  async convert_inline_quoted(node: AdocNode): Promise<string> {
    const text: string = node.text ?? "";
    let result: string;
    switch (node.type) {
      case "strong":
        result = wrap("#strong[", "]", text);
        break;
      case "emphasis":
        result = wrap("#emph[", "]", text);
        break;
      case "monospaced":
        result = wrap("#adoc-mono[", "]", text, { mono: true });
        break;
      case "mark":
        result = wrap("#highlight[", "]", text);
        break;
      case "superscript":
        result = wrap("#super[", "]", text);
        break;
      case "subscript":
        result = wrap("#sub[", "]", text);
        break;
      case "double":
        return `&#8220;${text}&#8221;`;
      case "single":
        return `&#8216;${text}&#8217;`;
      case "asciimath":
        if (usesTypstMath(node)) {
          const math = plainText(text).trim();
          return atom(`$${math}$`, { plain: math });
        }
        throw new UnsupportedSyntaxError(ASCIIMATH_UNSUPPORTED, {
          file: node.parent?.getFile(),
          line: node.parent?.getLineNumber(),
        });
      case "latexmath":
        return atom(`#mi(${str(plainText(text))})`, { plain: plainText(text) });
      default:
        result = text;
    }
    // Roles and ids decorate any quote type (`[.role]#text#`).
    const roles: string[] = node.role ? String(node.role).split(/\s+/).filter(Boolean) : [];
    const custom: string[] = [];
    for (const r of roles) {
      const m = SPAN_ROLE.get(r);
      if (m) result = wrap(m[0], m[1], result);
      else custom.push(r);
    }
    if (custom.length > 0) {
      const arr = `(${custom.map(str).join(", ")}${custom.length === 1 ? "," : ""})`;
      result = wrap(`#adoc-role(${arr})[`, "]", result);
    }
    if (node.id) result = atom(`#metadata(none)<${labelName(node.id)}>`, { plain: "" }) + result;
    return result;
  }

  async convert_inline_anchor(node: AdocNode): Promise<string> {
    switch (node.type) {
      case "xref": {
        const attrs = node.attributes ?? {};
        let text: string | null = node.text ?? null;
        if (typeof attrs.path === "string") {
          // Link to another document: Typst cannot resolve it.
          hooks.warn(`cross reference to another document is not resolved: ${attrs.path}`);
          return text ?? decodeEntities(String(attrs.path));
        }
        const refid = attrs.refid as string | undefined;
        const refs = node.document.catalog.refs;
        const ref = refid ? refs[refid] : undefined;
        if (!ref && refid) {
          hooks.warn(`unresolved cross reference: ${refid}`);
          return text ?? `[${refid}]`;
        }
        if (!text) {
          const resolved = ref ? await ref.xreftext(node.getAttribute("xrefstyle", null, true)) : null;
          text = resolved ?? `[${refid}]`;
        }
        const isBib = (ref as AdocNode | undefined)?.type === "bibref";
        return wrap(
          `#link(<${labelName(refid ?? "")}>)[`,
          "]",
          text,
          isBib ? { cite: refid } : { anchor: refid },
        );
      }
      case "ref":
        return atom(`#metadata(none)<${labelName(node.id ?? "")}>`, { plain: "" });
      case "bibref":
        // The visible `[label]` is part of the token so that it never reaches entry text.
        return atom(
          `#metadata(none)<${labelName(node.id ?? "")}>${escapeMarkup(`[${node.reftext || node.id}]`)}`,
          { plain: "", bib: { id: node.id ?? "", reftext: node.reftext ?? undefined } },
        );
      case "link": {
        const url = decodeEntities(await restorePassthroughs(node, String(node.target ?? "")));
        const text: string | null = node.text ?? null;
        const plain = text === null ? "" : plainText(text);
        if (text === null || text === "" || plain === url || node.hasRole?.("bare")) {
          return atom(`#link(${str(url)})`, { plain: url, href: url });
        }
        return wrap(`#link(${str(url)})[`, "]", text, { href: url });
      }
      default:
        hooks.warn(`unknown anchor type: ${node.type}`);
        return node.text ?? "";
    }
  }

  async convert_inline_break(node: AdocNode): Promise<string> {
    return (node.text ?? "") + token({ k: "atom", code: "\\", expr: false, plain: "\n", hardbreak: true });
  }

  async convert_inline_button(node: AdocNode): Promise<string> {
    return atom(`#adoc-btn(${str(plainText(node.text ?? ""))})`, { plain: plainText(node.text ?? "") });
  }

  async convert_inline_callout(node: AdocNode): Promise<string> {
    return callout(String(node.text));
  }

  async convert_inline_footnote(node: AdocNode): Promise<string> {
    // A reused footnote (`footnote:id[]`) carries the id in `target`.
    const id: string | undefined = node.id || node.target || undefined;
    if (node.type === "xref") {
      if (!id) {
        hooks.warn(`footnote reference without definition: ${node.text}`);
        return "";
      }
      return atom(`#footnote(<fn-${labelName(id)}>)`, { plain: "" });
    }
    const label = id ? `<fn-${labelName(id)}>` : "";
    return (
      atom("#footnote[", { expr: false, plain: "" }) + (node.text ?? "") + atom(`]${label}`, { plain: "" })
    );
  }

  async convert_inline_image(node: AdocNode): Promise<string> {
    const target = decodeEntities(await restorePassthroughs(node, String(node.target ?? "")));
    const alt = decodeEntities(String(node.getAlt?.() ?? node.getAttribute("alt") ?? ""));
    if (node.type === "icon") return atom(`#adoc-icon(${str(target)})`, { plain: alt });
    const path = hooks.bundleImage(String(await node.imageUri(target)));
    if (path === null) {
      hooks.warn(`remote image is not supported by Typst, emitted as a link: ${target}`);
      return atom(`#link(${str(target)})[`, { expr: false }) + escapeAlt(alt) + atom("]");
    }
    const args = [str(path), `alt: ${str(alt)}`];
    const w = dimension(node.getAttribute("width"));
    const h = dimension(node.getAttribute("height"));
    if (w) args.push(`width: ${w}`);
    if (h) args.push(`height: ${h}`);
    let code = `image(${args.join(", ")})`;
    const link = node.getAttribute("link");
    if (link) code = `link(${str(decodeEntities(String(link)))}, ${code})`;
    return atom(`#box(${code})`, { plain: alt });
  }

  async convert_inline_indexterm(node: AdocNode): Promise<string> {
    const raw = node.getAttribute("terms");
    const terms: string[] = Array.isArray(raw) && raw.length ? raw.map(String) : [String(node.text ?? "")];
    const visible = node.type === "visible";
    const arr = `(${terms.map((t) => str(plainText(t))).join(", ")}${terms.length === 1 ? "," : ""})`;
    return atom(`#adoc-indexterm(${arr}${visible ? ", visible: true" : ""})`, {
      plain: visible ? plainText(terms[0] ?? "") : "",
    });
  }

  async convert_inline_kbd(node: AdocNode): Promise<string> {
    const keys: string[] = node.getAttribute("keys") ?? [];
    return atom(`#adoc-kbd(${keys.map((k) => str(plainText(k))).join(", ")})`, { plain: keys.join("+") });
  }

  async convert_inline_menu(node: AdocNode): Promise<string> {
    const items = [
      node.getAttribute("menu"),
      ...(node.getAttribute("submenus") ?? []),
      node.getAttribute("menuitem"),
    ]
      .filter((x): x is string => typeof x === "string" && x !== "")
      .map((x) => plainText(x));
    return atom(`#adoc-menu(${items.map(str).join(", ")})`, { plain: items.join(" > ") });
  }
}

function escapeAlt(alt: string): string {
  return escapeMarkup(alt);
}

/** Converts an AsciiDoc dimension to a Typst length (px = 0.75pt, as asciidoctor-pdf does). */
export function dimension(v: unknown): string | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const m = /^(\d+(?:\.\d+)?)(%|px|pt|em|cm|mm|in)?$/.exec(String(v).trim());
  if (!m) return undefined;
  const n = Number(m[1]);
  if (m[2] === "%") return `${n}%`;
  if (m[2] === "px" || !m[2]) return `${Math.round(n * 75) / 100}pt`;
  return `${n}${m[2]}`;
}

/** Registers the converter for the `typst` backend (idempotent). */
let registered = false;
export function registerTypstConverter(): void {
  if (registered) return;
  TypstInlineConverter.registerFor("typst");
  registered = true;
}
