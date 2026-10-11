/**
 * Behavioural tests. Every test converts a fixture from tests/fixtures (the same ones the snapshots are built from) and asserts on a specific aspect of the result, so a failure points at the behaviour rather than at a whole-file diff.
 */
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { writeFiles } from "../src/assets.ts";
import { bodyOf, convertFixture, root } from "./fixtures.ts";

async function typst(name: string, options?: Parameters<typeof convertFixture>[1]): Promise<string> {
  return (await convertFixture(name, options)).typst;
}

async function messages(name: string): Promise<string[]> {
  return (await convertFixture(name)).diagnostics.map((d) => d.message);
}

describe("document header (article)", () => {
  test("title, subtitle, authors and revision", async () => {
    const out = await typst("article");
    expect(out).toContain("title: [An Article]");
    expect(out).toContain("subtitle: [With a Subtitle]");
    expect(out).toContain('(name: "Jane Doe", email: "jane@example.org"),');
    expect(out).toContain('(name: "Bob Roe"),');
    expect(out).toContain(
      'revision: (\n    number: "2.1",\n    date: "2026-03-04",\n    remark: "Second draft",\n    label: "Version",\n  ),',
    );
  });
  test("document attributes are passed on, Asciidoctor's built-ins are not", async () => {
    const out = await typst("article");
    expect(out).toContain('"custom-attribute": "custom value"');
    expect(out).toContain('"sectnums": ""');
    expect(out).not.toContain("docdate");
    expect(out).not.toContain("asciidoctor-version");
    expect(out).not.toContain('"author"');
  });
  test("doctype comes from the document and can be forced", async () => {
    expect(await typst("article")).toContain("#show: adoc-article.with(");
    expect(await typst("book")).toContain("#show: adoc-book.with(");
    expect(await typst("article", { doctype: "book" })).toContain("#show: adoc-book.with(");
  });
});

describe("attributes and conditionals", () => {
  test("references are substituted; missing ones are kept and reported", async () => {
    const out = await typst("attributes");
    expect(out).toContain("Hello World, a missing {nope} and an escaped {name}.");
    expect((await messages("attributes")).join("\n")).toContain("missing attribute: nope");
  });
  test("substituted values are not re-parsed as markup", async () => {
    expect(await typst("attributes")).toContain("stays literal text: \\*not bold\\*.");
  });
  test("counters", async () => {
    expect(await typst("attributes")).toContain("Counters: 1 2 3.");
  });
  test("ifdef, ifndef, ifeval and the single-line form", async () => {
    const out = bodyOf(await typst("attributes"));
    expect(out).toContain("A is set.");
    expect(out).not.toContain("A is unset.");
    expect(out).toContain("Any of them is set.");
    expect(out).not.toContain("All of them are set.");
    expect(out).toContain("Big n.");
    expect(out).toContain("Single-line form.");
  });
  test("backend attributes", async () => {
    const out = await typst("attributes");
    expect(out).toContain("The pdf backend attribute is defined.");
    expect(out).toContain("The typst backend attribute is defined.");
  });
  test("caller attributes override and resolve references", async () => {
    const result = await convertFixture("attributes", { attributes: { "from-caller": "from the CLI" } });
    expect(result.typst).toContain("Caller attribute: from the CLI.");
    expect(result.diagnostics.map((d) => d.message).join()).not.toContain("from-caller");
  });
});

describe("includes", () => {
  test("leveloffset shifts included headings and is restored afterwards", async () => {
    const out = await typst("includes");
    expect(out).toContain("= Included chapter <_included_chapter>");
    expect(out).toContain("== Included section <_included_section>");
    expect(out).toContain("= Back to the main file <_back_to_the_main_file>");
  });
  test("tags and line ranges", async () => {
    const out = await typst("includes");
    expect(out).toContain("Only this line is included.");
    expect(out).not.toContain("Not included");
    expect(out).toContain("second line");
    expect(out).not.toContain("first line");
    expect(out).not.toContain("third line");
  });
  test("a missing include is reported", async () => {
    expect((await messages("includes")).join()).toContain("include file not found");
  });
});

describe("inline", () => {
  test("quotes and marks", async () => {
    const out = await typst("inline");
    expect(out).toContain(
      '#strong[strong] #emph[emphasis] #raw("monospace") #highlight[mark] #super[super] #sub[sub] #strong[un]constrained.',
    );
    expect(out).toContain('#strong[#emph[nested] #raw("inside")]');
  });
  test("roles", async () => {
    const out = await typst("inline");
    expect(out).toContain("#underline[underlined]");
    expect(out).toContain("#strike[struck]");
    expect(out).toContain('#adoc-role(("custom-role",))[custom]');
  });
  test("curly quotes and typographic replacements", async () => {
    const out = await typst("inline");
    expect(out).toContain("“double quoted” and ‘single quoted’.");
    expect(out).toMatch(/© ® ™\s+—\s+dashes…/u);
    expect(out).toContain("arrows → ⇒ and it’s.");
  });
  test("constrained marks leave snake_case and math-like text alone", async () => {
    expect(await typst("inline")).toContain("snake\\_case\\_name and 2\\*3\\*4 alone.");
  });
  test("text after a code expression cannot become a call chain", async () => {
    expect(await typst("inline")).toContain("#strong[b]\\.foo and #strong[c]\\(x).");
  });
  test("passthroughs and escapes", async () => {
    const out = await typst("inline");
    expect(out).toContain("Passthroughs: \\*not bold\\* and a\\_b\\_c.");
    expect(out).toContain(
      "Escapes: \\*not bold\\*, 50% of \\$5 \\# tag, a\\_b\\_c, \\<angle>, \\[brackets\\]",
    );
  });
  test("links, autolinks, mail", async () => {
    const out = await typst("inline");
    expect(out).toContain('#link("https://example.org")[A link]');
    expect(out).toContain('#link("https://example.org/bare")');
    expect(out).toContain('#link("https://example.org/end").');
    expect(out).toContain('#link("mailto:user@example.org")[user\\@example.org]');
    expect(out).toContain('#link("page.html")[a relative link]');
  });
  test("hard line breaks", async () => {
    expect(await typst("inline")).toContain("A hard break\\\ncontinues.");
  });
  test("experimental macros, stem and index terms", async () => {
    const out = await typst("inline");
    expect(out).toContain('#adoc-kbd("Ctrl", "Shift", "N")');
    expect(out).toContain('#adoc-btn("OK")');
    expect(out).toContain('#adoc-menu("File", "Save As")');
    // `stem:[]` without `:stem:` is LaTeX here, not AsciiMath.
    expect(out).toContain('#mi("x^2")');
    expect(out).toContain('#adoc-indexterm(("visible",), visible: true)');
    expect(out).toContain('#adoc-indexterm(("hidden", "term"))');
  });
  test("line starts that look like markup are escaped", async () => {
    expect(await typst("inline")).toContain("\\= not a heading\n\\- not a list\n\\+ not a list");
  });
  test("math is passed as raw LaTeX, inline and as a block", async () => {
    const out = await typst("math");
    expect(out).toContain('#mi("x^2 + y^2")');
    expect(out).toContain('#mi("\\\\frac{a}{b}")');
    expect(out).toContain('#mitex("\\\\sum_{i=1}^{n} i = \\\\frac{n(n+1)}{2}")');
    expect(out).toContain('#mitex("\\\\int_0^1 x\\\\,dx")');
  });
  test("AsciiMath is refused, not converted", async () => {
    const { convert } = await import("../src/convert.ts");
    await expect(convert("= T\n\nasciimath:[a/b]\n")).rejects.toThrow(/AsciiMath is not supported/);
    await expect(convert("= T\n\n[asciimath]\n++++\na/b\n++++\n")).rejects.toThrow(
      /AsciiMath is not supported/,
    );
    await expect(convert("= T\n:stem: asciimath\n\ntext\n")).rejects.toThrow(/AsciiMath is not supported/);
    // An empty `:stem:` means AsciiMath in Asciidoctor.
    await expect(convert("= T\n:stem:\n\ntext\n")).rejects.toThrow(/AsciiMath is not supported/);
  });
  test("an unset :stem: means LaTeX", async () => {
    const { convert } = await import("../src/convert.ts");
    const { typst, diagnostics } = await convert("= T\n\nstem:[x]\n");
    expect(typst).toContain('#mi("x")');
    expect(diagnostics).toEqual([]);
  });
  test(":stem: typstmath reads stem content as Typst math and warns that it is non-standard", async () => {
    const { convert } = await import("../src/convert.ts");
    const { typst, diagnostics } = await convert(
      "= T\n:stem: typstmath\n\nInline stem:[sum_(i=1)^n i].\n\n[stem]\n++++\nx / 2\n++++\n",
    );
    expect(typst).toContain("Inline $sum_(i=1)^n i$.");
    expect(typst).toContain("$ x / 2 $");
    expect(typst).not.toContain("#mi(");
    expect(diagnostics.map((d) => d.message)).toEqual([
      expect.stringContaining(":stem: typstmath is not standard AsciiDoc"),
    ]);
  });
  test("typstmath is chosen with the stem attribute only; latexmath stays LaTeX", async () => {
    const { convert } = await import("../src/convert.ts");
    const { typst } = await convert("= T\n:stem: typstmath\n\nlatexmath:[\\frac{a}{b}]\n");
    expect(typst).toContain('#mi("\\\\frac{a}{b}")');
  });
});

describe("sections", () => {
  test("article sections start at level 1", async () => {
    const out = await typst("article");
    expect(out).toContain("= First section <_first_section>");
    expect(out).toContain("=== Deeper section with an explicit id <explicit-id>");
  });
  test("book without parts: chapters are level 1", async () => {
    const out = await typst("book");
    expect(out).toContain("parts: false");
    expect(out).toContain("= Chapter one <_chapter_one>");
    expect(out).toContain("== Section <_section>");
  });
  test("book with parts: everything shifts down one level", async () => {
    const out = await typst("book-multi-part");
    expect(out).toContain("parts: true");
    expect(out).toContain("= Part One <_part_one>");
    expect(out).toContain("== First chapter <_first_chapter>");
    expect(out).toContain("=== A section <_a_section>");
  });
  test("automatic ids are stable and de-duplicated", async () => {
    const out = await typst("article");
    expect(out).toContain("<_repeated_title>");
    expect(out).toContain("<_repeated_title_2>");
    expect(out).toContain("in the title <_section_with_monospace_and_emphasis_in_the_title>");
  });
  test("explicit ids, roles and discrete headings", async () => {
    const out = await typst("article");
    expect(out).toContain("<role-id>");
    expect(out).toContain('#adoc-role(("some-role",))[');
    expect(out).toContain("#heading(level: 2, outlined: false, numbering: none)[A discrete heading]");
  });
  test("special sections wrap their heading and content", async () => {
    const out = await typst("book-multi-part");
    expect(out).toContain("#adoc-preface[\n== Preface <_preface>\n\nA preface.\n]");
    expect(out).toContain("#adoc-appendix[");
    expect(out).toContain("#adoc-glossary[");
    expect(out).toContain("#adoc-dedication[");
  });
  test("the colophon uses the template function, which draws its own heading", async () => {
    const out = await typst("book-multi-part");
    expect(out).toContain("#colophon(title: [Colophon], level: 2)[Made with Typst.]");
    expect(out).not.toContain("adoc-colophon");
    expect(out).not.toContain("<_colophon>");
  });
  test("abstract and part intro", async () => {
    const out = await typst("book-multi-part");
    expect(out).toContain('#abstract(style: "block")[An abstract.]');
    expect(out).toContain("#adoc-partintro[\nIntroduction to part one.\n]");
  });
});

describe("lists", () => {
  test("nesting", async () => {
    expect(await typst("lists")).toContain("- unordered one\n  - nested\n    - deeper\n- unordered two");
  });
  test("ordered lists: start value and numbering styles", async () => {
    const out = await typst("lists");
    expect(out).toContain("4. starts at four\n+ five");
    expect(out).toContain('#set enum(numbering: "a.")');
    expect(out).toContain('#set enum(numbering: "I)")');
  });
  test("checklists", async () => {
    expect(await typst("lists")).toContain("- ☑ checked\n- ☐ unchecked");
  });
  test("list continuation attaches blocks to the item", async () => {
    expect(await typst("lists")).toContain(
      '- a list item\n\n  with an attached paragraph\n\n  #raw(block: true, "and an attached listing")\n- the next item',
    );
  });
  test("description lists: nesting and shared definitions", async () => {
    const out = await typst("lists");
    expect(out).toContain("/ Parent:\n  / Child: Nested definition.");
    expect(out).toContain("/ First term#linebreak()Second term: Shared definition.");
  });
  test("a list of a different kind right after a blank line nests (AsciiDoc semantics)", async () => {
    expect(await typst("lists")).toContain("- a parent item\n  + nested: a list of a different kind");
  });
  test("block titles on lists", async () => {
    expect(await typst("lists")).toContain("#adoc-block-title[A captioned list]\n- captioned item");
  });
});

describe("blocks", () => {
  test("admonitions", async () => {
    const out = await typst("blocks");
    expect(out).toContain('#adoc-admonition("note")[\nA note.\n]');
    expect(out).toContain('#adoc-admonition("tip", title: [Titled tip])[');
    expect(out).toContain('#adoc-admonition("warning")[\nCareful.\n]');
  });
  test("quote, verse, sidebar, example", async () => {
    const out = await typst("blocks");
    expect(out).toContain(
      "#quote(block: true, attribution: [Edsger W. Dijkstra, Letter])[\nSimplicity is prerequisite for reliability.\n]",
    );
    expect(out).toContain("#adoc-verse(attribution: [Anonymous])[\nRoses are red \\\nViolets are blue\n]");
    expect(out).toContain("#adoc-sidebar(title: [Sidebar title])[\nA sidebar.\n]");
    expect(out).toContain("#adoc-example(title: [Example title])[\nAn example.\n]");
  });
  test("breaks, roles and hard breaks", async () => {
    const out = await typst("blocks");
    expect(out).toContain("#line(length: 100%)");
    expect(out).toContain("#pagebreak()");
    expect(out).toContain('#adoc-role(("lead",))[\nA paragraph with a role.\n]');
    expect(out).toContain("Line one\\\nLine two");
  });
  test("comments are dropped", async () => {
    const out = await typst("blocks");
    expect(out).not.toContain("a line comment");
    expect(out).not.toContain("a block comment");
  });
  test("typst passthrough blocks are emitted verbatim", async () => {
    expect(await typst("blocks")).toContain("\n#lorem(5)\n");
  });
  test("images: captioned block image and inline image", async () => {
    const out = await typst("blocks");
    expect(out).toContain(
      '#figure(\n  align(center, image("images/diagram.svg", alt: "A diagram", width: 150pt)),\n  caption: [A captioned image],\n)',
    );
    expect(out).toContain('#box(image("images/diagram.svg", alt: "icon", width: 12pt))');
  });
  test("images are bundled once, next to main.typ", async () => {
    const result = await convertFixture("blocks");
    const images = result.files.filter((f) => f.path.startsWith("images/"));
    expect(images.map((f) => f.path)).toEqual(["images/diagram.svg"]);
    expect(images[0]!.source).toMatch(/fixtures[\\/]images[\\/]diagram\.svg$/);
  });
});

describe("code", () => {
  test("source blocks with callouts", async () => {
    const out = await typst("code");
    expect(out).toContain(
      '#adoc-callout-code(lang: "zig", callouts: ((0, 1), (2, 2)), "const std = @import(\\"std\\");',
    );
    expect(out).toContain("#adoc-callout-list(([Imports the standard library.], [The entry point.],))");
  });
  test("captioned listings become figures", async () => {
    expect(await typst("code")).toContain(
      '#figure(\n  raw(block: true, lang: "python", "def f():\\n    return \\"= not a heading\\""),\n  caption: [A captioned listing],\n)',
    );
  });
  test("listing content is verbatim", async () => {
    expect(await typst("code")).toContain('#raw(block: true, "plain listing with <angle> & *stars*")');
  });
  test("literal blocks keep indentation; fenced blocks keep their language", async () => {
    const out = await typst("code");
    expect(out).toContain('#raw(block: true, "literal block\\n    keeps indentation")');
    expect(out).toContain('#raw(block: true, lang: "rust", "fn main() {}")');
  });
});

describe("tables", () => {
  test("header row, column widths and caption", async () => {
    const out = await typst("tables");
    expect(out).toContain("columns: (1fr, 2fr, 1fr)");
    expect(out).toContain("table.header([Name], [Description], [Count])");
    expect(out).toContain("caption: [Captioned table]");
    expect(out).toContain("[The first letter, with #strong[markup].]");
  });
  test("column alignment is stated once, on the table", async () => {
    const out = await typst("tables");
    expect(out).toContain("align: (left, center, right)");
    expect(out).not.toContain("table.cell(align: center)[2]");
  });
  test("column and row spans", async () => {
    const out = await typst("tables");
    expect(out).toContain("table.cell(colspan: 2)[spans two columns]");
    expect(out).toContain("table.cell(rowspan: 2)[spans two rows]");
  });
  test("CSV tables and footers", async () => {
    const out = await typst("tables");
    expect(out).toContain("table.header([name], [value])");
    expect(out).toContain("table.footer([F1], [F2])");
  });
  test("AsciiDoc cells nest blocks", async () => {
    expect(await typst("tables")).toContain("[- list in a cell\n- another\n\nParagraph in a cell.]");
  });
});

describe("cross references and footnotes", () => {
  test("xrefs resolve to section titles, custom text and anchors", async () => {
    const out = await typst("xrefs");
    expect(out).toContain("#link(<target>)[Target section]");
    expect(out).toContain("#link(<target>)[custom text]");
    expect(out).toContain("#link(<target>)[an xref macro]");
    expect(out).toContain("#link(<_a_section>)[A section]");
    expect(out).toContain("#link(<anchored>)[\\[anchored\\]]");
    expect(out).toContain("#metadata(none)<anchored>A paragraph with an inline anchor.");
  });
  test("unresolved references are reported and kept readable", async () => {
    expect(await messages("xrefs")).toContain("unresolved cross reference: does-not-exist");
    expect(await typst("xrefs")).toContain("An unresolved reference: \\[does-not-exist\\].");
  });
  test("footnotes and reuse", async () => {
    const out = await typst("xrefs");
    expect(out).toContain("#footnote[The note text.]");
    expect(out).toContain("#footnote[A shared note.]<fn-shared> and again #footnote(<fn-shared>)");
  });
});

describe("bibliography", () => {
  const yaml = async (name: string) => (await convertFixture(name)).bibliographies[0] ?? "";
  const file = async (name: string, path: string) =>
    (await convertFixture(name)).files.find((f) => f.path === path)?.content;

  test("url-only entry", async () => {
    expect(await yaml("bibliography")).toContain(
      'dcm-dev: # AsciiDoc label: flutter-dcm\n  type: misc\n  url: "https://dcm.dev/"\n',
    );
  });
  test("title and url, with attributes substituted", async () => {
    expect(await yaml("bibliography")).toContain(
      'doctests:\n  type: misc\n  title: "Doctests in the Zig documentation"\n  url: "https://ziglang.org/documentation/0.16.0/#Doctests"\n',
    );
  });
  test("author, year and italic title, with the remainder as a note", async () => {
    expect(await yaml("bibliography")).toContain(
      'apa:\n  type: misc\n  author:\n    name: "Hunt & Thomas"\n  date: 1999\n  title: "The Pragmatic Programmer"\n  note: "Addison-Wesley"\n',
    );
  });
  test("nested items become notes; entries without an anchor are still listed", async () => {
    const out = await yaml("bibliography");
    expect(out).toContain(
      'nested:\n  type: misc\n  title: "An entry with nested items"\n  note: "Section 2.5: Limiting complexity."\n',
    );
    expect(out).toContain('title: "An entry without an anchor, still listed"');
    expect(out).toMatch(/^ref-\d+:$/m);
  });
  test("unstructured entries keep their whole text as the title", async () => {
    expect(await yaml("bibliography-deep")).toContain('title: "Gamma et al. Design Patterns. 1994"');
  });
  test("keys YAML would misread are quoted", async () => {
    expect(await yaml("bibliography-deep")).toStartWith('"no":');
  });
  test("the YAML is a file next to main.typ, referenced by path", async () => {
    const out = await typst("bibliography");
    expect(out).toContain('#bibliography(\n  full: true,\n  "bibliography.yaml",\n)');
    expect(out).not.toContain("bytes(");
    expect(await file("bibliography", "bibliography.yaml")).toStartWith("# Flutter/Dart\n");
  });
  test("citations", async () => {
    const out = await typst("bibliography");
    expect(out).toContain("Usage in citations @dcm-dev and @doctests, then @apa.");
  });
  test("a citation that runs into following text uses the long form", async () => {
    const out = await typst("bibliography-deep");
    expect(out).toContain("Cited as #cite(<no>)s and, at the end of a sentence, @no. Section:");
  });
  test("list captions become YAML comments above their group", async () => {
    const out = await yaml("bibliography");
    expect(out).toContain("# Flutter/Dart\ndcm-dev:");
    expect(out).toContain("\n\n# Zig\ndoctests:");
    expect(out).toContain("\n\n# Books\napa:");
  });
  test("custom labels are kept as YAML comments on the entry", async () => {
    const out = await yaml("bibliography");
    expect(out).toContain("dcm-dev: # AsciiDoc label: flutter-dcm\n");
    expect(out).toContain("doc-comments: # AsciiDoc label: zig-doc-comments\n");
    expect(out).toContain("\ndoctests:\n");
  });
  test("only the replaced section title is noted in main.typ", async () => {
    const out = await typst("bibliography");
    expect(out).not.toContain("list captions");
    expect(out).not.toContain("custom reference labels");
  });
  test("Typst's generated title replaces the section heading", async () => {
    const out = await typst("bibliography");
    expect(out).not.toContain("= References");
    expect(out).not.toContain("title: none");
    expect(out).toContain('the section title "References" is replaced by Typst\'s generated one');
  });
  test("the bibliography is bare: no wrapper function and no label", async () => {
    const out = await typst("bibliography");
    expect(out).not.toContain("adoc-bibliography");
    expect(out).not.toContain("<_references>");
    expect(out).toMatch(/\)\n$/);
  });
  test("a reference to a section without a label is plain text, not a dangling link", async () => {
    expect(await typst("bibliography-deep")).toContain("Section: Referencias.");
  });
  test("a nested bibliography keeps its heading level", async () => {
    const out = await typst("bibliography-deep");
    expect(out).toContain("#set heading(offset: 2)");
    expect(out).not.toContain("<_referencias>");
  });
  test("the YAML is also returned for callers that want a file", async () => {
    const result = await convertFixture("bibliography");
    expect(result.bibliographies).toHaveLength(1);
    expect(result.bibliographies[0]).toStartWith("# Flutter/Dart\ndcm-dev:");
  });
});

describe("real-world documents", () => {
  test("docent: a book with a glossary, nested description lists and a bibliography", async () => {
    const result = await convertFixture("docent");
    // Only the ignored attributes are reported (see "ignored attributes").
    expect(result.diagnostics.map((d) => d.message)).toEqual([
      "attribute :source-highlighter: is ignored (Typst highlights code itself)",
      "attribute :stem: is ignored (math is always LaTeX)",
    ]);
    expect(result.typst).toContain("title: [Docent]");
    expect(result.typst).toContain("subtitle: [Code Quality Linter for Zig]");
    expect(result.typst).toContain("/ Module types:\n  / Libraries or modules per-se:");
    expect(result.bibliographies).toHaveLength(1);
  });
  test("upsa-regulations: links with pass:[] targets and a captioned bibliography", async () => {
    const result = await convertFixture("upsa-regulations");
    expect(result.diagnostics).toEqual([]);
    expect(result.typst).toContain('#link("Reglamento de graduación.pdf")[Reglamento de graduación]');
    expect(result.bibliographies[0]).toContain('author:\n    name: "Estado Plurinacional de Bolivia"');
  });
});

/**
 * The UPSA regulations fixture exercises the title page: authors written inline (several, with underscore-joined names and a trailing `;`), revision information from attribute entries, a title logo, the three abstract forms and a bibliography with captions and custom labels.
 */
describe("authorship in the template library", () => {
  const typstAvailable = spawnSync("typst", ["--version"]).status === 0;

  /** Evaluates a Typst expression with `lib/authorship.typ` in scope and returns it as JSON. */
  function evaluate(expression: string): unknown {
    const dir = join(root, "out", "unit");
    mkdirSync(dir, { recursive: true });
    const file = join(dir, "authorship.typ");
    writeFileSync(file, `#import "/template/lib/authorship.typ": *\n#metadata(${expression}) <result>\n`);
    const r = spawnSync(
      "typst",
      ["query", "--root", root, file, "<result>", "--field", "value", "--one", "--format", "json"],
      { encoding: "utf8" },
    );
    expect(r.status).toBe(0);
    return JSON.parse(r.stdout);
  }

  test.skipIf(!typstAvailable)("derives first, last name and initials like AsciiDoc", () => {
    // `_` joins the words of one name.
    expect(evaluate('parse-author((name: "Jassiel Ovando_F.", email: "j@x.org"))')).toEqual({
      name: "Jassiel Ovando F.",
      email: "j@x.org",
      firstname: "Jassiel",
      lastname: "Ovando F.",
      initials: "JO",
    });
    expect(evaluate('parse-author((name: "Vivienne Y."))')).toEqual({
      name: "Vivienne Y.",
      firstname: "Vivienne",
      lastname: "Y.",
      initials: "VY",
    });
  });
  test.skipIf(!typstAvailable)("three names give a middle name; one name gives only a first name", () => {
    expect(evaluate('parse-author((name: "Ana María García"))')).toEqual({
      name: "Ana María García",
      firstname: "Ana",
      middlename: "María",
      lastname: "García",
      initials: "AMG",
    });
    expect(evaluate('parse-author((name: "Madonna"))')).toEqual({
      name: "Madonna",
      firstname: "Madonna",
      initials: "M",
    });
  });
  test.skipIf(!typstAvailable)("more than three words is kept whole as the first name", () => {
    expect(evaluate('parse-author((name: "Ana María de la Cruz"))')).toEqual({
      name: "Ana María de la Cruz",
      firstname: "Ana María de la Cruz",
      initials: "A",
    });
  });
  test.skipIf(!typstAvailable)("explicit keys win over derived ones", () => {
    const author = evaluate('parse-author((name: "Jane Doe", lastname: "Smith"))') as Record<string, string>;
    expect(author.lastname).toBe("Smith");
    expect(author.firstname).toBe("Jane");
  });
});

describe("upsa-regulations: authorship, revision and title page", () => {
  test("authors carry only the name as written and the email", async () => {
    const out = await typst("upsa-regulations");
    // `Ovando_F.` is one name: underscores join words, so the last name is "Ovando F.".
    expect(out).toContain('(name: "Jassiel Ovando_F.", email: "jassielovando@protonmail.com"),');
    // An author without an email, and a trailing `;` on the line, are fine.
    expect(out).toContain('(name: "Vivienne Y."),');
    expect(out.match(/^ {4}\(name: /gm)).toHaveLength(2);
    // First, middle and last name and the initials are derived by the library, not passed.
    expect(out).not.toContain("firstname:");
    expect(out).not.toContain("lastname:");
    expect(out).not.toContain("initials:");
  });
  test("author references in the body are lookups into the authors state, not values", async () => {
    const out = await typst("upsa-regulations");
    // {authorinitials_1}, {lastname_1}, {lastname_2}
    expect(out).toContain(
      '#author-field(field: "initials"), #author-field(field: "lastname"), #author-field(n: 2, field: "lastname")',
    );
    // Editing an author in Typst must reach every reference, so no value is frozen into the text.
    expect(out).not.toContain("JO, Ovando F., Y.");
    expect(out).not.toContain("{authorinitials_1}");
  });
  test("aggregate references and escapes", async () => {
    const { convert } = await import("../src/convert.ts");
    const { typst } = await convert(
      "= T\nA One; B Two\n\nAll: {authors}. Count: {authorcount}. Literal: \\{lastname_1}. Own: {mine}.\n",
    );
    expect(typst).toContain("All: #author-names(). Count: #author-count(). Literal: {lastname\\_1}.");
  });
  test("a reference inside a string cannot be a lookup and gets the current value", async () => {
    const { convert } = await import("../src/convert.ts");
    const { typst } = await convert("= T\nJane Doe <jane@example.org>\n:copyright: (c) {author}\n\ntext\n");
    expect(typst).toContain('"copyright": "(c) Jane Doe"');
  });
  test("a single author given by attributes is read the same way", async () => {
    const { convert } = await import("../src/convert.ts");
    const result = await convert(
      "= Title\n:author: Jane Doe\n:email: jane@example.org\n:doctype: book\n\ntext\n",
    );
    expect(result.typst).toContain('(name: "Jane Doe", email: "jane@example.org"),');
  });
  test("revision number, date and remark, with the document's version label", async () => {
    const out = await typst("upsa-regulations");
    expect(out).toContain('number: "1.0",');
    // `:revdate: {docdate}`; the tests pin SOURCE_DATE_EPOCH so the date is stable.
    expect(out).toContain('date: "2000-01-01",');
    expect(out).toContain('remark: "Adaptado de los reglamentos oficiales de la Universidad Privada');
    expect(out).toContain('label: "Versión",');
  });
  test("the title logo is built in the document and bundled next to main.typ", async () => {
    const result = await convertFixture("upsa-regulations");
    expect(result.typst).toContain('logo: (image: image("images/upsa-cross-green.svg", width: 25%)),');
    const logo = result.files.find((f) => f.path === "images/upsa-cross-green.svg");
    expect(logo?.source).toMatch(/fixtures[\\/]upsa-cross-green\.svg$/);
  });
  test("an abstract section, an abstract block and a titled abstract paragraph", async () => {
    const out = await typst("upsa-regulations");
    expect(out).toContain("#abstract(title: [Abstract])[\nEste repositorio contiene");
    expect(out).toContain('#abstract(style: "block")[\nThis article will take you');
    expect(out).toContain(
      '#abstract(style: "block", title: [Abstract])[Documentation is a distillation of many long adventures.]',
    );
  });
  test("the bundle is main.typ, one bibliography file, the images and the template", async () => {
    const result = await convertFixture("upsa-regulations");
    const paths = result.files.map((f) => f.path);
    expect(paths.filter((p) => !p.startsWith("template/"))).toEqual([
      "main.typ",
      "bibliography.yaml",
      "images/upsa-cross-green.svg",
    ]);
    expect(paths).toContain("template/lib.typ");
    expect(paths).toContain("template/lib/title-page.typ");
    expect(result.typst).toContain('#import "template/lib.typ": *');
  });
  test("a custom lib is imported as given and the template is not bundled", async () => {
    const result = await convertFixture("article", { lib: "my/lib.typ" });
    expect(result.files.map((f) => f.path)).toEqual(["main.typ"]);
    expect(result.typst).toContain('#import "my/lib.typ": *');
  });
  test("the bibliography is a file; captions and labels survive as YAML comments", async () => {
    const result = await convertFixture("upsa-regulations");
    expect(result.typst).toContain('#bibliography(\n  full: true,\n  "bibliography.yaml",\n)');
    expect(result.typst).not.toContain("<_referencias>");
    expect(result.typst).not.toContain("adoc-bibliography");
    const yaml = result.files.find((f) => f.path === "bibliography.yaml")?.content ?? "";
    expect(yaml).toStartWith("# Marco normativo nacional\ncpe: # AsciiDoc label: 1\n");
    expect(yaml).toContain("\n\n# Estatuto orgánico institucional\nupsa-statute: # AsciiDoc label: 4\n");
    expect(yaml).toContain("\n\n# Reglamentos internos obligatorios (D.S. 1433, Arts. 8–17)\nupsa-inst-reg:");
    expect(yaml).toContain(
      "\n\n# Reglamentos y normativas específicas complementarias\nupsa-internship-reg:",
    );
  });
});

describe("ignored attributes", () => {
  test("source-highlighter and stem are neither passed nor stored", async () => {
    const out = await typst("ignored-attributes");
    expect(out).toContain('attributes: ("kept": "this one is passed on")');
    expect(out).not.toContain('"source-highlighter"');
    expect(out).not.toContain('"stem"');
  });
  test("an unreferenced one is reported", async () => {
    const messages = await messages_("ignored-attributes");
    expect(messages).toContain("attribute :stem: is ignored (math is always LaTeX)");
  });
  test("a referenced one is just replaced by its value, with no warning", async () => {
    const out = await typst("ignored-attributes");
    expect(out).toContain("replaced by its value: rouge.");
    const messages = await messages_("ignored-attributes");
    expect(messages.join("\n")).not.toContain("source-highlighter");
  });
  test("the highlighter does not touch listings: Typst highlights them", async () => {
    expect(await typst("ignored-attributes")).toContain('#raw(block: true, lang: "zig", "const a = 1;")');
  });

  async function messages_(name: string): Promise<string[]> {
    return (await convertFixture(name)).diagnostics.map((d) => d.message);
  }
});

describe("heading numbering in a book with parts", () => {
  const typstAvailable = spawnSync("typst", ["--version"]).status === 0;

  /** Compiles a fixture and returns `[title, number]` for every heading, as Typst numbers them. */
  async function numbers(name: string): Promise<Array<[string, string | null]>> {
    const result = await convertFixture(name);
    const dir = join(root, "out", "numbering", name);
    writeFiles(dir, result.files);
    // Ask Typst for the number each heading is displayed with, evaluated at the heading.
    const probe = [
      result.typst,
      "#context [#metadata(query(heading).map(h => (",
      '  h.body.at("text", default: "?"),',
      "  if h.numbering == none { none } else { numbering(h.numbering, ..counter(heading).at(h.location())) },",
      ")))<numbers>]",
      "",
    ].join("\n");
    writeFileSync(join(dir, "main.typ"), probe);
    const r = spawnSync(
      "typst",
      ["query", join(dir, "main.typ"), "<numbers>", "--field", "value", "--one", "--format", "json"],
      { encoding: "utf8" },
    );
    expect(r.status).toBe(0);
    return JSON.parse(r.stdout);
  }

  test.skipIf(!typstAvailable)(
    "chapters are continuous across parts, parts are roman, sections follow their chapter",
    async () => {
      const headings = await numbers("book-multi-part");
      const numbered = Object.fromEntries(headings.filter(([, n]) => n !== null));
      expect(numbered).toEqual({
        "Part One": "I",
        "First chapter": "1",
        "A section": "1.1",
        "A subsection": "1.1.1",
        "A subsubsection": "1.1.1.1",
        "A paragraph": "1.1.1.1.1",
        "Second chapter": "2",
        "Part Two": "II",
        // Not "2.1": the chapter count does not restart with the part.
        "Third chapter": "3",
        // The first appendix restarts the chapter count (see the next test).
        "Extra material": "Appendix A",
      });
    },
    60_000,
  );

  test.skipIf(!typstAvailable)(
    "a normal book (no parts) keeps the plain numbering: chapters 1, 2 and sections 1.1",
    async () => {
      const numbered = Object.fromEntries((await numbers("book")).filter(([, n]) => n !== null));
      expect(numbered).toEqual({ "Chapter one": "1", Section: "1.1", "Chapter two": "2" });
    },
    60_000,
  );

  test.skipIf(!typstAvailable)(
    "appendices restart at A and special sections stay unnumbered",
    async () => {
      const headings = await numbers("book-multi-part");
      const byTitle = new Map(headings);
      expect(byTitle.get("Extra material")).toBe("Appendix A");
      for (const title of ["Preface", "Glossary", "Colophon", "For someone"]) {
        expect(byTitle.get(title) ?? null).toBeNull();
      }
    },
    60_000,
  );
});
