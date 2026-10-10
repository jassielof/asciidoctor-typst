/** Public conversion API: AsciiDoc source -> Typst source, parsed by Asciidoctor. */
import { readFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { load, MemoryLogger } from "@asciidoctor/core";
import type { AdocDocument, AdocNode } from "./ast.ts";
import { TypstEmitter } from "./emit.ts";
import { registerTypstConverter, setInlineHooks } from "./inline.ts";

export interface Diagnostic {
  level: "warning" | "error";
  message: string;
  file?: string;
  line?: number;
}

export interface ConvertOptions {
  /** Path of the source file; resolves includes and images. Needed for `include::`. */
  file?: string;
  /** Extra document attributes; `null` unsets one (like `-a name!`). */
  attributes?: Record<string, string | null>;
  /** Forces the doctype regardless of the document's own `:doctype:` entry. */
  doctype?: "book" | "article";
  /** Import path of the Typst template library. */
  lib?: string;
  /** Directory the Typst file will be written to; used to re-base image paths. */
  outputDir?: string;
  /** Directory includes may be read from (Asciidoctor safe-mode jail). Defaults to the source directory. */
  baseDir?: string;
}

export interface ConvertResult {
  typst: string;
  /**
   * Hayagriva YAML for each `[bibliography]` section, in document order. They are already
   * embedded in `typst` as `bytes(...)`; this is for callers that want them as files.
   */
  bibliographies: string[];
  diagnostics: Diagnostic[];
  /** The parsed Asciidoctor document, for inspection. */
  document: AdocDocument;
}

export const DEFAULT_LIB = "/template/lib.typ";

/** Attributes that are always derived and never interesting to the template. */
const NOISE =
  /^(?:doc|local)(?:date|time|year|datetime)$|^doc(?:file|filesuffix|name|dir|title)$|^doctype-|^(?:author|firstname|middlename|lastname|authorinitials|authors|authorcount|email|revnumber|revdate|revremark)(?:_\d+)?$|^(?:asciidoctor|safe-mode|backend-|basebackend-|filetype-)/;

export async function convert(source: string, options: ConvertOptions = {}): Promise<ConvertResult> {
  registerTypstConverter();
  const logger = MemoryLogger.create();
  const file = options.file ? resolve(options.file) : undefined;
  const baseDir = options.baseDir ?? (file ? dirname(file) : process.cwd());
  const sourceDir = file ? dirname(file) : undefined;
  const outputDir = options.outputDir ? resolve(options.outputDir) : undefined;

  const diagnostics: Diagnostic[] = [];
  const warn = (message: string, node?: AdocNode) => {
    const line = node?.getLineNumber?.() ?? undefined;
    diagnostics.push({ level: "warning", message, file: node?.getFile?.() ?? file, line });
  };

  // Installed before loading: Asciidoctor converts list items, titles and table cells during parse.
  setInlineHooks({
    warn: (m) => warn(m),
    rebase: (uri) => {
      if (/^[a-z][a-z0-9+.-]*:\/\//i.test(uri) || uri.startsWith("data:")) return null;
      const absolute = uri.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(uri);
      if (absolute || !sourceDir || !outputDir) return uri;
      return relative(outputDir, resolve(sourceDir, uri)).split(sep).join("/");
    },
  });

  const defaults: Record<string, string | boolean> = {
    // Typst produces PDF, so documents written for asciidoctor-pdf keep working.
    "backend-pdf": "",
    // No external highlighter runs for this backend; Typst highlights `raw` itself.
    "source-highlighter": false,
    // Report references to undefined attributes instead of silently skipping them.
    "attribute-missing": "warn",
  };
  const attributes: Record<string, string | boolean> = { ...defaults };
  for (const [k, v] of Object.entries(options.attributes ?? {})) attributes[k] = v === null ? false : v;
  if (options.doctype) attributes.doctype = options.doctype;

  const loadOptions = {
    safe: "safe",
    base_dir: baseDir,
    backend: "typst",
    sourcemap: true,
    attributes,
    logger,
  };
  // The implementation accepts { path, read } (it derives docfile/docdir from it); its typings don't.
  const input = (file ? { path: file, read: () => source } : source) as unknown as string;
  const doc = (await load(input, loadOptions)) as unknown as AdocDocument;

  const doctype = options.doctype ?? (doc.getDoctype() === "book" ? "book" : "article");

  // Attributes the document (or caller) set, as opposed to Asciidoctor's built-ins.
  const baseline = (await load("", { ...loadOptions, attributes: defaults })).getAttributes() as Record<
    string,
    unknown
  >;
  const headerAttributes: Record<string, string> = {};
  for (const [k, v] of Object.entries(doc.getAttributes() as Record<string, unknown>)) {
    if (NOISE.test(k) || typeof v !== "string") continue;
    if (baseline[k] === v) continue;
    headerAttributes[k] = v;
  }

  const emitter = new TypstEmitter(doc, {
    lib: options.lib ?? DEFAULT_LIB,
    doctype,
    attributes: headerAttributes,
    sourceDir,
    outputDir,
    warn,
  });
  const typst = await emitter.emit();

  // Asciidoctor's own diagnostics (missing includes, unterminated blocks, ...).
  for (const m of logger.messages) {
    const sev = m.getSeverity().toUpperCase();
    if (sev !== "WARN" && sev !== "ERROR" && sev !== "FATAL") continue;
    const loc = m.getSourceLocation();
    diagnostics.push({
      level: sev === "WARN" ? "warning" : "error",
      message: m.getText(),
      file: (loc?.getFile() as string | undefined) ?? file,
      line: loc?.getLineNumber(),
    });
  }
  return { typst, bibliographies: emitter.bibliographies, diagnostics, document: doc };
}

export async function convertFile(path: string, options: ConvertOptions = {}): Promise<ConvertResult> {
  return convert(await readFile(path, "utf8"), { ...options, file: path });
}
