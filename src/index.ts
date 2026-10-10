#!/usr/bin/env bun
/** adoc2typ command line interface. */
import { writeFiles } from "./assets.ts";
import { convertFile, DEFAULT_LIB } from "./convert.ts";

export { convert, convertFile } from "./convert.ts";
export type { ConvertOptions, ConvertResult, OutputFile } from "./convert.ts";
export { writeFiles } from "./assets.ts";

const USAGE = `Usage: adoc2typ <input.adoc> [options]

Options:
  -o, --output <dir>      Write the Typst project (main.typ, bibliography YAML, images) to <dir>.
                          Without it, main.typ goes to stdout (an error if other files are needed)
  -a, --attribute <name[=value]|name!>
                          Set or unset a document attribute (repeatable)
  -d, --doctype <type>    Force doctype: book | article
      --lib <path>        Import path of the Typst template library (default: ${DEFAULT_LIB})
      --strict            Exit with status 1 when any warning was reported
  -h, --help              Show this help`;

async function main(argv: string[]): Promise<number> {
  let input: string | undefined;
  let output: string | undefined;
  let doctype: "book" | "article" | undefined;
  let lib: string | undefined;
  let strict = false;
  const attributes: Record<string, string | null> = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`missing value for ${arg}`);
      return v;
    };
    switch (arg) {
      case "-h":
      case "--help":
        console.log(USAGE);
        return 0;
      case "-o":
      case "--output":
        output = next();
        break;
      case "-d":
      case "--doctype": {
        const v = next();
        if (v !== "book" && v !== "article") throw new Error(`unsupported doctype: ${v}`);
        doctype = v;
        break;
      }
      case "--lib":
        lib = next();
        break;
      case "--strict":
        strict = true;
        break;
      case "-a":
      case "--attribute": {
        const v = next();
        const eq = v.indexOf("=");
        if (v.endsWith("!") && eq < 0) attributes[v.slice(0, -1)] = null;
        else if (eq < 0) attributes[v] = "";
        else attributes[v.slice(0, eq)] = v.slice(eq + 1);
        break;
      }
      default:
        if (arg.startsWith("-")) throw new Error(`unknown option: ${arg}`);
        if (input) throw new Error("only one input file is supported");
        input = arg;
    }
  }

  if (!input) {
    console.error(USAGE);
    return 2;
  }

  const result = await convertFile(input, { attributes, doctype, lib });
  for (const d of result.diagnostics) {
    const where = d.file ? `${d.file}${d.line ? `:${d.line}` : ""}: ` : "";
    console.error(`${where}${d.level}: ${d.message}`);
  }
  if (output) {
    writeFiles(output, result.files);
  } else if (result.files.length > 1) {
    const extra = result.files.filter((f) => f.path !== "main.typ").map((f) => f.path);
    throw new Error(`the document needs more than main.typ (${extra.join(", ")}); pass -o <dir>`);
  } else {
    process.stdout.write(result.typst);
  }
  return strict && result.diagnostics.length > 0 ? 1 : 0;
}

if (import.meta.main) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (e) {
    console.error(`adoc2typ: ${(e as Error).message}`);
    process.exitCode = 2;
  }
}
