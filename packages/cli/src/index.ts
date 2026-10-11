#!/usr/bin/env bun
/** asciidoctor-typst command line interface. */
import { Command, CommanderError, InvalidArgumentError, Option } from "commander";
import { writeFileSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { compileToPdf, CompileError, convertFile, DEFAULT_LIB, writeFiles } from "../../core/src/index.ts";
import pkg from "../../../package.json" with { type: "json" };

type Attributes = Record<string, string | null>;

interface Options {
  output?: string;
  typst?: boolean;
  attribute?: Attributes;
  doctype?: "book" | "article";
  lib?: string;
  strict?: boolean;
}

/** `name=value` sets, `name` sets it empty and `name!` unsets (Asciidoctor's `-a` syntax). */
function collectAttribute(value: string, previous: Attributes): Attributes {
  const eq = value.indexOf("=");
  const name = eq < 0 ? value : value.slice(0, eq);
  if (!name || name === "!") throw new InvalidArgumentError(`not an attribute: ${value}`);
  if (eq < 0 && name.endsWith("!")) return { ...previous, [name.slice(0, -1)]: null };
  return { ...previous, [name]: eq < 0 ? "" : value.slice(eq + 1) };
}

export function createProgram(onResult: (code: number) => void = () => {}): Command {
  return new Command("asciidoctor-typst")
    .description(
      "Compiles an AsciiDoc document to PDF with Typst. With --typst it only writes the Typst source, to compile with your own Typst CLI (custom root, fonts, PDF standard, ...).",
    )
    .version(pkg.version)
    .argument("<input>", "AsciiDoc document")
    .option(
      "-o, --output <path>",
      "PDF to write (default: <input>.pdf); with --typst, the directory for the Typst project (without it, main.typ goes to stdout)",
    )
    .option("--typst", "write the Typst source instead of compiling it")
    .option(
      "-a, --attribute <name[=value]|name!>",
      "set or unset a document attribute (repeatable)",
      collectAttribute,
    )
    .addOption(new Option("-d, --doctype <type>", "force the doctype").choices(["book", "article"]))
    .option("--lib <path>", "import path of the Typst template library", DEFAULT_LIB)
    .option("--strict", "exit with status 1 when any warning was reported")
    .showHelpAfterError("(add --help for usage)")
    .action(async (input: string, options: Options) => {
      onResult(await convertAction(input, options));
    });
}

async function convertAction(input: string, options: Options): Promise<number> {
  const result = await convertFile(input, {
    attributes: options.attribute ?? {},
    doctype: options.doctype,
    lib: options.lib,
  });
  for (const d of result.diagnostics) {
    const where = d.file ? `${d.file}${d.line ? `:${d.line}` : ""}: ` : "";
    console.error(`${where}${d.level}: ${d.message}`);
  }

  if (!options.typst) {
    try {
      const pdf = await compileToPdf(result, { lib: options.lib });
      writeFileSync(options.output ?? join(dirname(input), `${basename(input, extname(input))}.pdf`), pdf);
    } catch (e) {
      if (!(e instanceof CompileError)) throw e;
      for (const m of e.messages) console.error(m);
      return 1;
    }
  } else if (options.output) {
    writeFiles(options.output, result.files);
  } else if (result.files.length > 1) {
    const extra = result.files.filter((f) => f.path !== "main.typ").map((f) => f.path);
    throw new Error(`the document needs more than main.typ (${extra.join(", ")}); pass -o <dir>`);
  } else {
    process.stdout.write(result.typst);
  }
  return options.strict && result.diagnostics.length > 0 ? 1 : 0;
}

/** Runs the CLI with `argv` (without the executable and script) and returns the exit status. */
export async function run(argv: string[]): Promise<number> {
  let status = 0;
  const program = createProgram((code) => (status = code)).exitOverride();
  try {
    await program.parseAsync(argv, { from: "user" });
  } catch (e) {
    if (e instanceof CommanderError) return e.exitCode;
    console.error(`asciidoctor-typst: ${(e as Error).message}`);
    return 2;
  }
  return status;
}

if (import.meta.main) process.exitCode = await run(process.argv.slice(2));
