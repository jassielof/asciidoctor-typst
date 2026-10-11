/**
 * In-process PDF compilation of a converted bundle with typst.ts, so that the Typst CLI is not needed. Options of `typst compile` (root, font paths, PDF standard, …) are deliberately not exposed: to use them, write the Typst source bundle and compile it with the CLI.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import type { TypstSnippet } from "@myriaddreamin/typst.ts/contrib/snippet";
import { DEFAULT_LIB, type ConvertResult } from "./convert.ts";

const TEMPLATE_DIR = fileURLToPath(new URL("../template", import.meta.url));
const FONTS_DIR = fileURLToPath(new URL("../assets/fonts", import.meta.url));
const FONT_FILE = /\.(otf|ttf|otc|ttc)$/i;
const PACKAGE_REF = /@preview\/([a-z0-9_-]+):(\d+\.\d+\.\d+)/g;

export interface CompileOptions {
  /** Import path of the template library, as given to the conversion. */
  lib?: string;
}

/** Raised when Typst rejects the document; `messages` holds one line per diagnostic. */
export class CompileError extends Error {
  constructor(readonly messages: string[]) {
    super(messages.join("\n"));
    this.name = "CompileError";
  }
}

type Typst = TypstSnippet;

const packages = new Map<string, Uint8Array>();
let instance: Promise<Typst> | undefined;

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

/** Reads the file names and contents of a gzipped ustar archive. */
function untar(gz: Uint8Array): Map<string, Uint8Array> {
  const tar = gunzipSync(gz);
  const files = new Map<string, Uint8Array>();
  const text = (from: number, length: number) =>
    new TextDecoder().decode(tar.subarray(from, from + length)).replace(/\0.*$/s, "");
  for (let at = 0; at + 512 <= tar.length;) {
    const name = text(at, 100);
    if (!name) break;
    const size = parseInt(text(at + 124, 12).trim() || "0", 8);
    const type = String.fromCharCode(tar[at + 156]!);
    const prefix = text(at + 345, 155);
    if (type === "0" || type === "\0")
      files.set(prefix ? `${prefix}/${name}` : name, tar.subarray(at + 512, at + 512 + size));
    at += 512 + Math.ceil(size / 512) * 512;
  }
  return files;
}

function cacheFile(name: string, version: string): string {
  return join(
    process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"),
    "adoc2typ",
    "packages",
    `${name}-${version}.tar.gz`,
  );
}

async function fetchPackage(name: string, version: string): Promise<Uint8Array> {
  const cached = cacheFile(name, version);
  if (existsSync(cached)) return new Uint8Array(readFileSync(cached));
  const url = `https://packages.typst.org/preview/${name}-${version}.tar.gz`;
  const response = await fetch(url);
  if (!response.ok)
    throw new CompileError([
      `error: cannot download package @preview/${name}:${version} (${response.status} ${url})`,
    ]);
  const data = new Uint8Array(await response.arrayBuffer());
  mkdirSync(dirname(cached), { recursive: true });
  writeFileSync(cached, data);
  return data;
}

/**
 * typst.ts resolves packages synchronously, which cannot be done over the network here, so every `@preview` package the sources import (transitively) is downloaded beforehand.
 */
async function prefetchPackages(sources: string[]): Promise<void> {
  const queue = sources.flatMap((s) => [...s.matchAll(PACKAGE_REF)].map((m) => [m[1]!, m[2]!] as const));
  while (queue.length > 0) {
    const [name, version] = queue.pop()!;
    const key = `${name}-${version}`;
    if (packages.has(key)) continue;
    const data = await fetchPackage(name, version);
    packages.set(key, data);
    for (const [path, content] of untar(data)) {
      if (!path.endsWith(".typ")) continue;
      const source = new TextDecoder().decode(content);
      for (const m of source.matchAll(PACKAGE_REF)) queue.push([m[1]!, m[2]!]);
    }
  }
}

async function typst(): Promise<Typst> {
  instance ??= (async () => {
    const { $typst, MemoryAccessModel } = await import("@myriaddreamin/typst.ts");
    const snippet = $typst.constructor as typeof TypstSnippet;
    const wasm = fileURLToPath(import.meta.resolve("@myriaddreamin/typst-ts-web-compiler/wasm"));
    const wrapper = import.meta.resolve("@myriaddreamin/typst-ts-web-compiler/pkg/typst_ts_web_compiler.mjs");
    $typst.setCompilerInitOptions({ getModule: () => readFileSync(wasm), getWrapper: () => import(wrapper) });
    // The template's own fonts first; the default font assets (text, CJK, emoji, math) are fetched on top of them.
    const fonts = walk(FONTS_DIR)
      .filter((p) => FONT_FILE.test(p))
      .map((p) => new Uint8Array(readFileSync(p)));
    if (fonts.length > 0) $typst.use(snippet.preloadFonts(fonts));
    const access = new MemoryAccessModel();
    $typst.use(
      snippet.withAccessModel(access),
      snippet.fetchPackageBy(access, (spec) => packages.get(`${spec.name}-${spec.version}`)),
    );
    return $typst;
  })();
  return instance;
}

/** Files of the template library the document imports, as `[virtual path, bytes]`. */
function libraryFiles(lib: string): [string, Uint8Array][] {
  if (lib.startsWith("@")) return [];
  let directory: string;
  let virtual: string;
  if (lib === DEFAULT_LIB) {
    directory = TEMPLATE_DIR;
    virtual = "/template";
  } else {
    const path = lib.startsWith("/") ? lib : `/${lib}`;
    virtual = dirname(path);
    directory = resolve(process.cwd(), "." + virtual);
  }
  return walk(directory)
    .filter((p) => p.endsWith(".typ"))
    .map((p) => [
      `${virtual}/${p.slice(directory.length + 1).replaceAll("\\", "/")}`,
      new Uint8Array(readFileSync(p)),
    ]);
}

/** Compiles a converted document to PDF. */
export async function compileToPdf(result: ConvertResult, options: CompileOptions = {}): Promise<Uint8Array> {
  const lib = options.lib ?? DEFAULT_LIB;
  const library = libraryFiles(lib);
  if (!lib.startsWith("@") && library.length === 0)
    throw new CompileError([`error: template library not found: ${lib}`]);
  const files: [string, Uint8Array][] = [
    ...library,
    ...result.files.map((f): [string, Uint8Array] => [
      `/${f.path}`,
      f.content !== undefined ? new TextEncoder().encode(f.content) : new Uint8Array(readFileSync(f.source!)),
    ]),
  ];
  await prefetchPackages(
    files.filter(([p]) => p.endsWith(".typ")).map(([, data]) => new TextDecoder().decode(data)),
  );

  // The compiler wrapper warns about its own initialization call on every first use.
  const warn = console.warn;
  console.warn = (...args: unknown[]) => {
    if (!String(args[0]).includes("deprecated parameters for the initialization")) warn(...args);
  };
  try {
    const compiler = await typst();
    await compiler.resetShadow();
    for (const [path, data] of files) await compiler.mapShadow(path, data);
    return (await compiler.pdf({ mainFilePath: "/main.typ" }))!;
  } catch (e) {
    throw e instanceof CompileError || typeof e !== "string" ? e : new CompileError(parseDiagnostics(e));
  } finally {
    console.warn = warn;
  }
}

/** typst.ts rejects with the Rust `Debug` rendering of the diagnostics; this recovers severity, message and hints from it. */
function parseDiagnostics(raw: string): string[] {
  const entries = [
    ...raw.matchAll(
      /SourceDiagnostic \{ severity: (\w+), .*?message: "((?:[^"\\]|\\.)*)", trace: \[.*?\], hints: \[(.*?)\] \}/gs,
    ),
  ];
  if (entries.length === 0) return [raw];
  return entries.map(([, severity, message, hints]) => {
    const list = [...(hints ?? "").matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((h) => `\n  hint: ${h[1]}`).join("");
    return `${severity!.toLowerCase()}: ${message!.replace(/\\"/g, '"')}${list}`;
  });
}
