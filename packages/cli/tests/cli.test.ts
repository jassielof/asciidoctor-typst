import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../src/index.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "adoc2typ-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function document(source: string): string {
  const path = join(dir, "doc.adoc");
  writeFileSync(path, source);
  return path;
}

/** Runs the CLI with stderr and stdout captured. */
async function cli(...argv: string[]) {
  const err: string[] = [];
  const out: string[] = [];
  const error = console.error;
  const write = process.stdout.write;
  console.error = (...a: unknown[]) => void err.push(a.join(" "));
  process.stdout.write = ((chunk: string) =>
    void out.push(String(chunk))) as unknown as typeof process.stdout.write;
  try {
    return { status: await run(argv), stderr: err.join("\n"), stdout: out.join("") };
  } finally {
    console.error = error;
    process.stdout.write = write;
  }
}

describe("adoc2typ", () => {
  test("--typst without -o prints main.typ", async () => {
    const { status, stdout } = await cli(document("= T\n\nHello.\n"), "--typst");
    expect(status).toBe(0);
    expect(stdout).toContain("#show: adoc-article.with(");
    expect(stdout).toContain("Hello.");
  });

  test("--typst -o writes the project directory", async () => {
    const out = join(dir, "project");
    const { status } = await cli(document("= T\n\nHello.\n"), "--typst", "-o", out);
    expect(status).toBe(0);
    expect(existsSync(join(out, "main.typ"))).toBe(true);
  });

  test("-a sets and unsets attributes, -d forces the doctype", async () => {
    const { stdout } = await cli(
      document("= T\n\n{greeting} and {gone}.\n"),
      "--typst",
      "-a",
      "greeting=Hi",
      "-a",
      "gone!",
      "-d",
      "book",
    );
    expect(stdout).toContain("adoc-book.with(");
    expect(stdout).toContain("Hi and");
  });

  test("by default the document is compiled to <input>.pdf", async () => {
    const input = document("= T\n\nHello.\n");
    const { status } = await cli(input);
    expect(status).toBe(0);
    expect(readFileSync(join(dir, "doc.pdf")).subarray(0, 5).toString()).toBe("%PDF-");
  }, 120_000);

  test("--strict fails on warnings", async () => {
    const input = document("= T\n\nSee <<nowhere>>.\n");
    const { status, stderr } = await cli(input, "--typst", "--strict");
    expect(status).toBe(1);
    expect(stderr).toContain("warning:");
  });

  test("invalid options are usage errors", async () => {
    const input = document("= T\n");
    expect((await cli(input, "-d", "slides")).status).not.toBe(0);
    expect((await cli(input, "--nope")).status).not.toBe(0);
    expect((await cli()).status).not.toBe(0);
  });
});
