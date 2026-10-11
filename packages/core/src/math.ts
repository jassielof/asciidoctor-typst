import type { AdocNode } from "./ast.ts";

/** The value of `:stem:` that selects Typst math instead of LaTeX. Not part of AsciiDoc, which only knows `latexmath` and `asciimath`. */
export const TYPST_MATH = "typstmath";

/** Whether the document writes its `stem` content as Typst math (`:stem: typstmath`). Asciidoctor types that content as AsciiMath, which is then what the converter reads as Typst. */
export function usesTypstMath(node: AdocNode): boolean {
  const stem = node.document.getAttribute("stem");
  return typeof stem === "string" && stem.trim().toLowerCase() === TYPST_MATH;
}
