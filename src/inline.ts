/**
 * Inline conversion: a custom Asciidoctor converter for the `typst` backend.
 *
 * Asciidoctor runs its own inline substitutions (quotes, macros, replacements, ...) and calls
 * the converter for each inline node. Text it produces is HTML-escaped, so converter output
 * cannot simply be concatenated: Typst code must survive the later substitution passes and must
 * not be escaped as text. Converter methods therefore return *tokens* (private-use delimited
 * indexes into a table). `renderInline` splits a converted string back into text segments
 * (entity-decoded and escaped for Typst) and tokens (expanded to Typst code).
 */
import { ConverterBase } from "@asciidoctor/core";
import { decodeEntities, escapeMarkup, labelName, str } from "./escape.ts";

const OPEN = "";
const CLOSE = "";

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
}
interface Open {
  k: "open";
  code: string;
  pair: number;
  mono: boolean;
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

const atom = (code: string, extra: Partial<Atom> = {}): string => token({ k: "atom", code, expr: true, ...extra });

function wrap(open: string, close: string, text: string, mono = false): string {
  const pair = pairSeq++;
  return token({ k: "open", code: open, pair, mono }) + text + token({ k: "close", code: close, pair });
}

/** Hooks the converter needs from the caller (path re-basing, diagnostics). */
export interface InlineHooks {
  /** Maps an image URI (already joined with `imagesdir`) to a path Typst can load; null if remote. */
  rebase(uri: string): string | null;
  warn(message: string): void;
}
let hooks: InlineHooks = { rebase: (t) => t, warn: () => {} };
export function setInlineHooks(h: InlineHooks): void {
  hooks = h;
}

const callout = (n: string) => atom("", { callout: Number(n), plain: "" });

type TextPart = { t: "text"; v: string };
type TokPart = { t: "tok"; e: Entry };

function split(s: string): Array<TextPart | TokPart> {
  const out: Array<TextPart | TokPart> = [];
  const re = new RegExp(`${OPEN}(\\d+)${CLOSE}`, "g");
  let last = 0;
  for (const m of s.matchAll(re)) {
    if (m.index! > last) out.push({ t: "text", v: s.slice(last, m.index) });
    out.push({ t: "tok", e: table[Number(m[1])]! });
    last = m.index! + m[0].length;
  }
  if (last < s.length) out.push({ t: "text", v: s.slice(last) });
  return out;
}

/** Plain text of a converted string: entities decoded, markup dropped. */
export function plainText(s: string): string {
  return split(s)
    .map((p) => (p.t === "text" ? decodeEntities(p.v) : p.e.k === "atom" ? (p.e.plain ?? "") : ""))
    .join("");
}

/**
 * Verbatim text with callout markers removed. Returns the decoded text and, for each marker, the
 * zero-based line it was on.
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
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]!;
    if (p.t === "text") {
      let s = escapeMarkup(decodeEntities(p.v), opts.colons);
      // `#f[x].y` is a field access and `#f[x](y)` a further call: keep following text literal.
      if (prevExpr && /^(?:\.[\p{L}_]|[(\[])/u.test(s)) s = "\\" + s;
      out += s;
      if (s !== "") prevExpr = false;
      continue;
    }
    const e = p.e;
    if (e.k === "atom") {
      out += e.code;
      if (e.hardbreak && !(parts[i + 1]?.t === "text" && (parts[i + 1] as TextPart).v.startsWith("\n"))) out += "\n";
      if (e.code !== "") prevExpr = e.expr;
    } else if (e.k === "open") {
      if (e.mono) {
        const close = parts.findIndex((q, j) => j > i && q.t === "tok" && q.e.k === "close" && q.e.pair === e.pair);
        const end = close < 0 ? parts.length : close;
        const inner = parts.slice(i + 1, end);
        if (inner.every((q) => q.t === "text")) {
          out += `#raw(${str(inner.map((q) => decodeEntities((q as TextPart).v)).join(""))})`;
        } else {
          out += `#adoc-mono[${renderParts(inner, opts)}]`;
        }
        prevExpr = true;
        i = end;
      } else {
        out += e.code;
        prevExpr = false;
      }
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

export class TypstInlineConverter extends ConverterBase {
  constructor(backend: string, opts: object = {}) {
    super(backend, opts);
    (this as any).initBackendTraits({
      basebackend: "typst",
      filetype: "typ",
      outfilesuffix: ".typ",
      supportsTemplates: false,
    });
  }

  async convert_inline_quoted(node: any): Promise<string> {
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
        result = wrap("#adoc-mono[", "]", text, true);
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
      case "latexmath":
        return atom(`#adoc-math(${str(node.type)}, ${str(plainText(text))})`, { plain: plainText(text) });
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

  async convert_inline_anchor(node: any): Promise<string> {
    switch (node.type) {
      case "xref": {
        const attrs = node.attributes ?? {};
        let text: string | null = node.text ?? null;
        if (attrs.path) {
          // Link to another document: Typst cannot resolve it.
          hooks.warn(`cross reference to another document is not resolved: ${attrs.path}`);
          return text ?? decodeEntities(String(attrs.path));
        }
        const refid: string | undefined = attrs.refid;
        const refs = node.document.catalog.refs;
        const ref = refid ? refs[refid] : undefined;
        if (!ref && refid) {
          hooks.warn(`unresolved cross reference: ${refid}`);
          return text ?? `[${refid}]`;
        }
        if (!text) {
          const resolved: string | null = ref ? await ref.xreftext(node.getAttribute("xrefstyle", null, true)) : null;
          text = resolved ?? `[${refid}]`;
        }
        return atom(`#link(<${labelName(refid ?? "")}>)[`, { expr: false }) + text + atom("]");
      }
      case "ref":
        return atom(`#metadata(none)<${labelName(node.id)}>`, { plain: "" });
      case "bibref":
        return (
          atom(`#metadata(none)<${labelName(node.id)}>`, { plain: "" }) + `[${node.reftext || node.id}]`
        );
      case "link": {
        const url = decodeEntities(String(node.target ?? ""));
        const text: string | null = node.text ?? null;
        const plain = text === null ? "" : plainText(text);
        if (text === null || text === "" || plain === url || node.hasRole?.("bare")) {
          return atom(`#link(${str(url)})`, { plain: url });
        }
        return atom(`#link(${str(url)})[`, { expr: false }) + text + atom("]");
      }
      default:
        hooks.warn(`unknown anchor type: ${node.type}`);
        return node.text ?? "";
    }
  }

  async convert_inline_break(node: any): Promise<string> {
    return (node.text ?? "") + token({ k: "atom", code: "\\", expr: false, plain: "\n", hardbreak: true });
  }

  async convert_inline_button(node: any): Promise<string> {
    return atom(`#adoc-btn(${str(plainText(node.text ?? ""))})`, { plain: plainText(node.text ?? "") });
  }

  async convert_inline_callout(node: any): Promise<string> {
    return callout(String(node.text));
  }

  async convert_inline_footnote(node: any): Promise<string> {
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
    return atom("#footnote[", { expr: false, plain: "" }) + (node.text ?? "") + atom(`]${label}`, { plain: "" });
  }

  async convert_inline_image(node: any): Promise<string> {
    const target = decodeEntities(String(node.target ?? ""));
    const alt = decodeEntities(String(node.getAlt?.() ?? node.getAttribute("alt") ?? ""));
    if (node.type === "icon") return atom(`#adoc-icon(${str(target)})`, { plain: alt });
    const path = hooks.rebase(String(await node.imageUri(target)));
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

  async convert_inline_indexterm(node: any): Promise<string> {
    const raw = node.getAttribute("terms");
    const terms: string[] = Array.isArray(raw) && raw.length ? raw.map(String) : [String(node.text ?? "")];
    const visible = node.type === "visible";
    const arr = `(${terms.map((t) => str(plainText(t))).join(", ")}${terms.length === 1 ? "," : ""})`;
    return atom(`#adoc-indexterm(${arr}${visible ? ", visible: true" : ""})`, {
      plain: visible ? plainText(terms[0] ?? "") : "",
    });
  }

  async convert_inline_kbd(node: any): Promise<string> {
    const keys: string[] = node.getAttribute("keys") ?? [];
    return atom(`#adoc-kbd(${keys.map((k) => str(plainText(k))).join(", ")})`, { plain: keys.join("+") });
  }

  async convert_inline_menu(node: any): Promise<string> {
    const items = [node.getAttribute("menu"), ...(node.getAttribute("submenus") ?? []), node.getAttribute("menuitem")]
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
  (TypstInlineConverter as any).registerFor("typst");
  registered = true;
}
