/** Thrown when the document uses something that cannot be converted, so conversion is refused. */
export class UnsupportedSyntaxError extends Error {
  override readonly name = "UnsupportedSyntaxError";

  constructor(message: string, location?: { file?: string; line?: number }) {
    const where = location?.file ? `${location.file}${location.line ? `:${location.line}` : ""}: ` : "";
    super(where + message);
  }
}

/** AsciiMath has no Typst equivalent and mitex only reads LaTeX, so it is refused rather than guessed at. */
export const ASCIIMATH_UNSUPPORTED =
  "AsciiMath is not supported, only LaTeX math is: write the formula as LaTeX (`latexmath:[...]`, `[latexmath]` or `[stem]` with `:stem: latexmath`)";
