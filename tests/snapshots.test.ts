/**
 * Snapshot tests: every fixture (and sample) is converted and compared with the stored Typst in
 * tests/snapshots. The stored output is then compiled with Typst to prove it is valid.
 *
 *   bun test                          compare
 *   UPDATE_SNAPSHOTS=1 bun test       rewrite snapshots (review the diff before committing!)
 */
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { convertFile } from "../src/convert.ts";

const root = resolve(import.meta.dir, "..");
const fixtures = join(import.meta.dir, "fixtures");
const snapshots = join(import.meta.dir, "snapshots");
const update = process.env.UPDATE_SNAPSHOTS === "1";
const typstAvailable = spawnSync("typst", ["--version"]).status === 0;

interface Case {
  name: string;
  source: string;
}

const cases: Case[] = [
  ...readdirSync(fixtures)
    .filter((f) => f.endsWith(".adoc"))
    .sort()
    .map((f) => ({ name: `fixtures-${basename(f, ".adoc")}`, source: join(fixtures, f) })),
  { name: "fixtures-includes", source: join(fixtures, "includes", "main.adoc") },
  { name: "samples-docent", source: join(root, "samples", "docent.adoc") },
  { name: "samples-multipart-book", source: join(root, "samples", "multipart", "book.adoc") },
  { name: "samples-upsa-regulations", source: join(root, "samples", "upsa-regulations.adoc") },
];

function readOptional(path: string): string | undefined {
  return existsSync(path) ? readFileSync(path, "utf8").replace(/\r\n/g, "\n") : undefined;
}

function compareOrUpdate(path: string, actual: string | undefined, label: string): void {
  if (update) {
    if (actual === undefined || actual === "") rmSync(path, { force: true });
    else writeFileSync(path, actual);
    return;
  }
  const expected = readOptional(path);
  if (expected === undefined && (actual === undefined || actual === "")) return;
  if (expected === undefined) {
    throw new Error(`${label}: no snapshot at ${relative(root, path)} (run with UPDATE_SNAPSHOTS=1)`);
  }
  expect(actual).toBe(expected);
}

mkdirSync(snapshots, { recursive: true });

describe("snapshots", () => {
  for (const c of cases) {
    test(c.name, async () => {
      const result = await convertFile(c.source, { outputDir: snapshots, lib: "/template/lib.typ" });
      const diagnostics = result.diagnostics
        .map(
          (d) =>
            `${d.level}: ${d.message}${d.file ? ` (${basename(d.file)}${d.line ? `:${d.line}` : ""})` : ""}`,
        )
        .join("\n");
      compareOrUpdate(join(snapshots, `${c.name}.typ`), result.typst, c.name);
      compareOrUpdate(
        join(snapshots, `${c.name}.diagnostics.txt`),
        diagnostics ? diagnostics + "\n" : "",
        c.name,
      );
    });
  }
});

describe("snapshots compile with typst", () => {
  for (const c of cases) {
    test.skipIf(!typstAvailable)(
      c.name,
      () => {
        const typ = join(snapshots, `${c.name}.typ`);
        if (!existsSync(typ)) throw new Error(`missing snapshot ${relative(root, typ)}`);
        const out = join(root, "out", "snapshots");
        mkdirSync(out, { recursive: true });
        const r = spawnSync("typst", ["compile", "--root", root, typ, join(out, `${c.name}.pdf`)], {
          encoding: "utf8",
        });
        expect(r.stderr).not.toContain("error");
        expect(r.status).toBe(0);
      },
      120_000,
    );
  }
});
