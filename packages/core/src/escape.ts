/** Escaping and literal helpers for Typst markup and code. */

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  copy: "©",
  reg: "®",
  trade: "™",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  larr: "←",
  rarr: "→",
  uarr: "↑",
  darr: "↓",
  harr: "↔",
  lArr: "⇐",
  rArr: "⇒",
  deg: "°",
  times: "×",
  divide: "÷",
  plusmn: "±",
  middot: "·",
  bull: "•",
  euro: "€",
  pound: "£",
  yen: "¥",
  cent: "¢",
  sect: "§",
  para: "¶",
  laquo: "«",
  raquo: "»",
  iexcl: "¡",
  iquest: "¿",
  ensp: " ",
  emsp: " ",
  thinsp: " ",
  zwj: "‍",
  zwnj: "‌",
  shy: "­",
};

/** Decodes the HTML entities Asciidoctor leaves in converted text. */
export function decodeEntities(s: string): string {
  if (!s.includes("&")) return s;
  return s.replace(/&(#\d+|#x[\da-fA-F]+|[A-Za-z][A-Za-z0-9]*);/g, (m, body: string) => {
    if (body[0] === "#") {
      const cp = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : Number(body.slice(1));
      return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
    }
    return ENTITIES[body] ?? m;
  });
}

/** Escapes text for Typst markup mode. `colons` also escapes `:` (inside term-list terms). `;` is always escaped: right after an inline call (`#link(..)[..];`) it would end the code expression and vanish. */
export function escapeMarkup(s: string, colons = false): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    switch (c) {
      case "\\":
      case "#":
      case "$":
      case "*":
      case "_":
      case "`":
      case "~":
      case "<":
      case "@":
      case "[":
      case "]":
      case ";":
        out += "\\" + c;
        break;
      case "-":
        out += s[i + 1] === "-" || s[i + 1] === "?" || s[i - 1] === "-" ? "\\-" : "-";
        break;
      case ".":
        out += s[i + 1] === "." && s[i + 2] === "." ? "\\." : ".";
        break;
      case "/":
        out += s[i + 1] === "/" ? "\\/" : "/";
        break;
      case ":":
        out += colons ? "\\:" : ":";
        break;
      default:
        out += c;
    }
  }
  return out;
}

/** Escapes characters that would start list/heading/term syntax at the start of a line. */
export function escapeLineStarts(text: string): string {
  return text
    .split("\n")
    .map((l) => l.replace(/^(\s*)(=+|[-+/])(?=\s|$)/, "$1\\$2").replace(/^(\s*)(\d+)\.(?=\s|$)/, "$1$2\\."))
    .join("\n");
}

/** Typst string literal. */
export function str(s: string): string {
  let out = '"';
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (ch === "\\") out += "\\\\";
    else if (ch === '"') out += '\\"';
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else if (cp < 0x20 || cp === 0x7f) out += `\\u{${cp.toString(16)}}`;
    else out += ch;
  }
  return out + '"';
}

/** A valid Typst label name for an AsciiDoc id. */
export function labelName(id: string): string {
  return id.replace(/[^\p{L}\p{N}_:.-]/gu, "_");
}

export function indent(text: string, pad: string): string {
  return text
    .split("\n")
    .map((l) => (l === "" ? l : pad + l))
    .join("\n");
}

export function oneLine(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}
