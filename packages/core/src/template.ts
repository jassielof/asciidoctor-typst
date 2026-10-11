/** The Typst template library ships with every bundle, so a converted document compiles on its own. */
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { OutputFile } from "./assets.ts";

export const TEMPLATE_DIR = fileURLToPath(new URL("../template", import.meta.url));

/** Where the template lives inside a bundle, and the path `main.typ` imports it from by default. */
export const TEMPLATE_PREFIX = "template/";

function walk(dir: string, prefix = ""): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path, `${prefix}${name}/`) : [`${prefix}${name}`];
  });
}

/** The template's Typst sources, as bundle entries below `template/`. */
export function templateFiles(): OutputFile[] {
  return walk(TEMPLATE_DIR)
    .filter((p) => p.endsWith(".typ"))
    .sort()
    .map((p) => ({ path: TEMPLATE_PREFIX + p, source: join(TEMPLATE_DIR, ...p.split("/")) }));
}
