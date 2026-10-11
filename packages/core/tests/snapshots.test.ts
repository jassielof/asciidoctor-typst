/**
 * Snapshot tests. Every fixture is converted and its generated text files (`main.typ`, the Hayagriva YAML, ...) are compared with the stored copies in `tests/snapshots/<fixture>/`; `diagnostics.txt` there records the warnings the fixture is expected to produce. Binary assets (copied images) are not stored: the compile test writes the whole bundle and compiles it with Typst to prove it is valid on its own.
 *
 *   bun test                          compare
 *   UPDATE_SNAPSHOTS=1 bun test       rewrite snapshots (review the diff before committing!)
 */
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { writeFiles } from "../src/assets.ts";
import { TEMPLATE_PREFIX } from "../src/template.ts";
import { convertFixture, formatDiagnostics, listFixtures, root, snapshotsDir } from "./fixtures.ts";

const update = process.env.UPDATE_SNAPSHOTS === "1";
const typstAvailable = spawnSync("typst", ["--version"]).status === 0;
const fixtures = listFixtures();

const DIAGNOSTICS = "diagnostics.txt";

/** Every file below `dir`, as `/`-separated relative paths. */
function listFiles(dir: string, prefix = ""): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? listFiles(join(dir, e.name), `${prefix}${e.name}/`) : [`${prefix}${e.name}`],
  );
}

function read(path: string): string {
  return readFileSync(path, "utf8").replace(/\r\n/g, "\n");
}

mkdirSync(snapshotsDir, { recursive: true });

describe("snapshots", () => {
  for (const f of fixtures) {
    test(f.name, async () => {
      const result = await convertFixture(f.name);
      const expected = new Map<string, string>();
      for (const file of result.files) if (file.content !== undefined) expected.set(file.path, file.content);
      const diagnostics = formatDiagnostics(result);
      if (diagnostics) expected.set(DIAGNOSTICS, diagnostics + "\n");

      const dir = join(snapshotsDir, f.name);
      if (update) {
        rmSync(dir, { recursive: true, force: true });
        for (const [path, content] of expected) {
          mkdirSync(dirname(join(dir, path)), { recursive: true });
          writeFileSync(join(dir, path), content);
        }
        // The copied assets are part of the snapshot too: without them the stored `main.typ` does not compile on its own. The template is the exception: it is the same in every bundle and lives in `packages/core/template`.
        for (const file of result.files) {
          if (file.source === undefined || file.path.startsWith(TEMPLATE_PREFIX)) continue;
          mkdirSync(dirname(join(dir, file.path)), { recursive: true });
          copyFileSync(file.source, join(dir, file.path));
        }
        // A link instead of a copy, so a snapshot can be compiled in place without inflating the repository.
        symlinkSync(relative(dir, resolve(root, "template")), join(dir, "template"), "dir");
        return;
      }

      // Only text files are snapshots; previews of a snapshot in place (a PDF, copied images) are not.
      const stored = listFiles(dir)
        .filter((f) => /\.(typ|ya?ml|txt)$/.test(f))
        .sort();
      expect(stored).toEqual([...expected.keys()].sort());
      for (const file of result.files) {
        if (file.source === undefined || file.path.startsWith(TEMPLATE_PREFIX)) continue;
        if (!existsSync(join(dir, file.path))) {
          throw new Error(
            `${f.name}: asset missing from the snapshot: ${relative(root, join(dir, file.path))} (UPDATE_SNAPSHOTS=1)`,
          );
        }
      }
      for (const [path, content] of expected) {
        if (!existsSync(join(dir, path))) {
          throw new Error(`${f.name}: no snapshot ${relative(root, join(dir, path))} (UPDATE_SNAPSHOTS=1)`);
        }
        expect(content).toBe(read(join(dir, path)));
      }
    });
  }
});

describe("bundles compile with typst", () => {
  for (const f of fixtures) {
    test.skipIf(!typstAvailable)(
      f.name,
      async () => {
        const result = await convertFixture(f.name);
        // The bundle carries the template, so it compiles from anywhere.
        const out = join(root, "out", "snapshots", f.name);
        rmSync(out, { recursive: true, force: true });
        writeFiles(out, result.files);
        const r = spawnSync("typst", ["compile", join(out, "main.typ"), join(out, "main.pdf")], {
          encoding: "utf8",
        });
        expect(r.stderr).not.toContain("error");
        expect(r.status).toBe(0);
      },
      120_000,
    );
  }
});
