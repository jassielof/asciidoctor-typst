/**
 * In-process compilation (typst.ts). Needs network on first use: the `@preview/mitex` package and the default font assets are downloaded.
 */
import { describe, expect, test } from "bun:test";
import { compileToPdf, CompileError } from "../src/compile.ts";
import { convertFixture } from "./fixtures.ts";

const pdfHeader = (pdf: Uint8Array) => new TextDecoder().decode(pdf.subarray(0, 5));

describe("compileToPdf", () => {
  for (const name of ["article", "math", "upsa-regulations", "book-multi-part"]) {
    test(`${name} compiles to a PDF`, async () => {
      const pdf = await compileToPdf(await convertFixture(name));
      expect(pdfHeader(pdf)).toBe("%PDF-");
    }, 120_000);
  }

  test("a missing template library is reported", async () => {
    const result = await convertFixture("article");
    const error = await compileToPdf(result, { lib: "/missing/lib.typ" }).catch((e) => e);
    expect(error).toBeInstanceOf(CompileError);
    expect(error.message).toContain("template library not found");
  });

  test("Typst errors are reported as diagnostics", async () => {
    const result = await convertFixture("article");
    const files = result.files.map((f) =>
      f.path === "main.typ" ? { ...f, content: `${f.content}\n#undefined-function()\n` } : f,
    );
    const error = await compileToPdf({ ...result, files }).catch((e) => e);
    expect(error).toBeInstanceOf(CompileError);
    expect(error.messages[0]).toStartWith("error: ");
  });
});
