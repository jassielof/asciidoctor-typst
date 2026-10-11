/**
 * Fixture discovery and conversion shared by the test files.
 *
 * A fixture is either `fixtures/<name>.adoc` or a directory `fixtures/<name>/main.adoc` (for multi-file documents). Its expected output is the directory `snapshots/<name>/`.
 */
import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { convertFile, type ConvertOptions, type ConvertResult } from "../src/convert.ts";

// `{docdate}` and friends come from the file modification time unless SOURCE_DATE_EPOCH is set. Midday UTC, so the date is the same in every time zone.
process.env.SOURCE_DATE_EPOCH ??= "946728000";

export const root = resolve(import.meta.dir, "..");
export const fixturesDir = join(import.meta.dir, "fixtures");
export const snapshotsDir = join(import.meta.dir, "snapshots");

export interface Fixture {
  name: string;
  source: string;
}

export function listFixtures(): Fixture[] {
  const out: Fixture[] = [];
  for (const entry of readdirSync(fixturesDir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".adoc")) {
      out.push({ name: entry.name.slice(0, -".adoc".length), source: join(fixturesDir, entry.name) });
    } else if (entry.isDirectory() && existsSync(join(fixturesDir, entry.name, "main.adoc"))) {
      out.push({ name: entry.name, source: join(fixturesDir, entry.name, "main.adoc") });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export function fixturePath(name: string): string {
  const fixture = listFixtures().find((f) => f.name === name);
  if (!fixture) throw new Error(`unknown fixture: ${name}`);
  return fixture.source;
}

/** Converts a fixture the way the snapshots are produced. */
export function convertFixture(name: string, options: ConvertOptions = {}): Promise<ConvertResult> {
  return convertFile(fixturePath(name), { lib: "/template/lib.typ", ...options });
}

/** The generated document without its `#import`/`#show` header. */
export function bodyOf(typst: string): string {
  const i = typst.indexOf("\n)\n");
  return typst.slice(i + 3).trim();
}

/** Diagnostics as stored in `<name>.diagnostics.txt`; absolute paths are made repo-relative. */
export function formatDiagnostics(result: ConvertResult): string {
  // The root appears with either separator style; strip it together with its trailing separator.
  const alternatives = [...new Set([root, root.replace(/\\/g, "/")])]
    .map((r) => r.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  const rootPattern = new RegExp(`(?:${alternatives})[\\\\/]?`, "g");
  return result.diagnostics
    .map((d) => {
      const file = d.file?.split(/[\\/]/).pop();
      const message = d.message.replace(rootPattern, "");
      return `${d.level}: ${message}${file ? ` (${file}${d.line ? `:${d.line}` : ""})` : ""}`;
    })
    .join("\n");
}
