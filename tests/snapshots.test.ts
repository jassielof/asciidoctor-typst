/**
 * Snapshot tests: every fixture is converted and compared with the stored Typst in
 * tests/snapshots (plus `<name>.diagnostics.txt` when it is expected to warn). The stored output
 * is then compiled with Typst to prove it is valid.
 *
 *   bun test                          compare
 *   UPDATE_SNAPSHOTS=1 bun test       rewrite snapshots (review the diff before committing!)
 */
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { convertFixture, formatDiagnostics, listFixtures, root, snapshotsDir } from "./fixtures.ts";

const update = process.env.UPDATE_SNAPSHOTS === "1";
const typstAvailable = spawnSync("typst", ["--version"]).status === 0;
const fixtures = listFixtures();

function readOptional(path: string): string | undefined {
  return existsSync(path) ? readFileSync(path, "utf8").replace(/\r\n/g, "\n") : undefined;
}

function compareOrUpdate(path: string, actual: string, label: string): void {
  if (update) {
    if (actual === "") rmSync(path, { force: true });
    else writeFileSync(path, actual);
    return;
  }
  const expected = readOptional(path);
  if (expected === undefined && actual === "") return;
  if (expected === undefined) {
    throw new Error(`${label}: no snapshot at ${relative(root, path)} (run with UPDATE_SNAPSHOTS=1)`);
  }
  expect(actual).toBe(expected);
}

mkdirSync(snapshotsDir, { recursive: true });

describe("snapshots", () => {
  for (const f of fixtures) {
    test(f.name, async () => {
      const result = await convertFixture(f.name);
      const diagnostics = formatDiagnostics(result);
      compareOrUpdate(join(snapshotsDir, `${f.name}.typ`), result.typst, f.name);
      compareOrUpdate(
        join(snapshotsDir, `${f.name}.diagnostics.txt`),
        diagnostics ? diagnostics + "\n" : "",
        f.name,
      );
    });
  }
});

describe("snapshots compile with typst", () => {
  for (const f of fixtures) {
    test.skipIf(!typstAvailable)(
      f.name,
      () => {
        const typ = join(snapshotsDir, `${f.name}.typ`);
        if (!existsSync(typ)) throw new Error(`missing snapshot ${relative(root, typ)}`);
        const out = join(root, "out", "snapshots");
        mkdirSync(out, { recursive: true });
        const r = spawnSync("typst", ["compile", "--root", root, typ, join(out, `${f.name}.pdf`)], {
          encoding: "utf8",
        });
        expect(r.stderr).not.toContain("error");
        expect(r.status).toBe(0);
      },
      120_000,
    );
  }
});
