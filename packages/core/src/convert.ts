/** Public conversion API: AsciiDoc source -> a Typst project, parsed by Asciidoctor. */
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { load, MemoryLogger } from "@asciidoctor/core";
import { AssetBundle, type OutputFile } from "./assets.ts";
import type { AdocDocument, AdocNode } from "./ast.ts";
import { referencedAttributes, resolveLiterals, withInfoReferences } from "./info-refs.ts";
import { TypstEmitter } from "./emit.ts";
import { TYPST_MATH, usesTypstMath } from "./math.ts";
import { ASCIIMATH_UNSUPPORTED, UnsupportedSyntaxError } from "./errors.ts";
import { registerTypstConverter, setInlineHooks } from "./inline.ts";

export type { OutputFile } from "./assets.ts";

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
  /** Directory includes may be read from (Asciidoctor safe-mode jail). Defaults to the source directory. */
  baseDir?: string;
}

export interface ConvertResult {
  /** The content of `main.typ`. */
  typst: string;
  /**
   * Everything the document needs, as paths inside the output directory: `main.typ`, the Hayagriva YAML of each bibliography and the images it uses (those carry `source` instead of `content`). Writing them side by side makes `typst compile main.typ` work.
   */
  files: OutputFile[];
  /** The Hayagriva YAML of each `[bibliography]` section, in document order. */
  bibliographies: string[];
  diagnostics: Diagnostic[];
  /** The parsed Asciidoctor document, for inspection. */
  document: AdocDocument;
}

export const DEFAULT_LIB = "/template/lib.typ";
export const MAIN_FILE = "main.typ";

/** Attributes with no meaning for Typst, and why. They are never passed to the template. */
const IGNORED_ATTRIBUTES: Record<string, string> = {
  "source-highlighter": "Typst highlights code itself",
  stem: "math is always LaTeX",
};

/** Attributes that are always derived and never interesting to the template. */
const NOISE =
  /^(?:doc|local)(?:date|time|year|datetime)$|^doc(?:file|filesuffix|name|dir|title)$|^doctype-|^(?:author|firstname|middlename|lastname|authorinitials|authors|authorcount|email|revnumber|revdate|revremark)(?:_\d+)?$|^(?:asciidoctor|safe-mode|backend-|basebackend-|filetype-)/;

export function convert(source: string, options: ConvertOptions = {}): Promise<ConvertResult> {
  // References to authors, revision, language and document type become lookups into the template's states instead of frozen values.
  return withInfoReferences(() => convertDocument(source, options));
}

async function convertDocument(source: string, options: ConvertOptions): Promise<ConvertResult> {
  registerTypstConverter();
  const logger = MemoryLogger.create();
  const file = options.file ? resolve(options.file) : undefined;
  const baseDir = options.baseDir ?? (file ? dirname(file) : process.cwd());
  const sourceDir = file ? dirname(file) : process.cwd();

  const diagnostics: Diagnostic[] = [];
  const warn = (message: string, node?: AdocNode) => {
    const line = node?.getLineNumber?.() ?? undefined;
    diagnostics.push({ level: "warning", message, file: node?.getFile?.() ?? file, line });
  };

  // Installed before loading: Asciidoctor converts list items, titles and table cells during parse.
  const assets = new AssetBundle(sourceDir, (m) => warn(m));
  setInlineHooks({ warn: (m) => warn(m), bundleImage: (uri) => assets.image(uri) });

  const defaults: Record<string, string | boolean> = {
    // Typst produces PDF, so documents written for asciidoctor-pdf keep working.
    "backend-pdf": "",
    // Math is LaTeX (rendered with mitex). A soft default: `stem:[]` and `[stem]` mean LaTeX math unless the document says otherwise, which is then rejected. "tex" is an alias Asciidoctor knows, and is what tells "left at the default" from "set by the document".
    stem: "tex@",
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

  // Only LaTeX math is supported: Typst has no AsciiMath, and the Typst math syntax would need non-standard AsciiDoc. `:stem:` left at its default means LaTeX (see `defaults`).
  const stem = doc.getAttribute("stem");
  if (typeof stem === "string" && /^(?:asciimath|ascii)?$/i.test(stem.trim())) {
    throw new UnsupportedSyntaxError(
      `${ASCIIMATH_UNSUPPORTED}; \`:stem:\` is ${stem === "" ? "empty (AsciiMath)" : stem}`,
      {
        file,
      },
    );
  }

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
    assets,
    warn,
  });
  // References that sit inside strings (URLs, alt texts, attribute values, YAML) cannot be lookups; they get the current value.
  const typst = resolveLiterals(await emitter.emit());
  for (const f of emitter.files) if (f.content !== undefined) f.content = resolveLiterals(f.content);
  const bibliographies = emitter.bibliographies.map(resolveLiterals);

  // Attributes that mean nothing for Typst are neither passed nor stored. One that is referenced in the document is still replaced by its value (Asciidoctor does that), so it is only reported when nothing uses it.
  const referenced = referencedAttributes();
  for (const [name, reason] of Object.entries(IGNORED_ATTRIBUTES)) {
    // `:stem: typstmath` is not ignored: it selects the math syntax, and is reported below.
    if (name === "stem" && usesTypstMath(doc)) continue;
    if (name in headerAttributes && !referenced.has(name)) {
      diagnostics.push({ level: "warning", message: `attribute :${name}: is ignored (${reason})`, file });
    }
  }

  if (usesTypstMath(doc)) {
    diagnostics.push({
      level: "warning",
      message: `:stem: ${TYPST_MATH} is not standard AsciiDoc (AsciiDoc only has latexmath and asciimath): stem content is read as Typst math, and other AsciiDoc processors will not render it`,
      file,
    });
  }

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

  const files: OutputFile[] = [{ path: MAIN_FILE, content: typst }, ...emitter.files, ...assets.files];
  return { typst, files, bibliographies, diagnostics, document: doc };
}

export async function convertFile(path: string, options: ConvertOptions = {}): Promise<ConvertResult> {
  return convert(await readFile(path, "utf8"), { ...options, file: path });
}
