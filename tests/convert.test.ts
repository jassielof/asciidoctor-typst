/**
 * Behavioural tests. Every test converts a fixture from tests/fixtures (the same ones the
 * snapshots are built from) and asserts on a specific aspect of the result, so a failure points
 * at the behaviour rather than at a whole-file diff.
 */
import { describe, expect, test } from "bun:test";
import { bodyOf, convertFixture } from "./fixtures.ts";

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
    expect(out).toContain('authors: ((name: "Jane Doe", email: "jane@example.org"), (name: "Bob Roe"))');
    expect(out).toContain('revision: (number: "2.1", date: "2026-03-04", remark: "Second draft")');
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
    expect(await typst("book-chapters")).toContain("#show: adoc-book.with(");
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
    expect(out).toContain('#adoc-math("asciimath", "x^2")');
    expect(out).toContain('#adoc-indexterm(("visible",), visible: true)');
    expect(out).toContain('#adoc-indexterm(("hidden", "term"))');
  });
  test("line starts that look like markup are escaped", async () => {
    expect(await typst("inline")).toContain("\\= not a heading\n\\- not a list\n\\+ not a list");
  });
  test("stem follows the document's :stem: attribute", async () => {
    const out = await typst("math");
    expect(out).toContain('#adoc-math("latexmath", "x^2 + y^2")');
    expect(out).toContain('#adoc-math("asciimath", "a/b")');
    expect(out).toContain(
      '#adoc-math("latexmath", "\\\\sum_{i=1}^{n} i = \\\\frac{n(n+1)}{2}", block: true)',
    );
  });
});

describe("sections", () => {
  test("article sections start at level 1", async () => {
    const out = await typst("article");
    expect(out).toContain("= First section <_first_section>");
    expect(out).toContain("=== Deeper section with an explicit id <explicit-id>");
  });
  test("book without parts: chapters are level 1", async () => {
    const out = await typst("book-chapters");
    expect(out).toContain("parts: false");
    expect(out).toContain("= Chapter one <_chapter_one>");
    expect(out).toContain("== Section <_section>");
  });
  test("book with parts: everything shifts down one level", async () => {
    const out = await typst("book-parts");
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
    const out = await typst("book-parts");
    expect(out).toContain("#adoc-preface[\n== Preface <_preface>\n\nA preface.\n]");
    expect(out).toContain("#adoc-appendix[");
    expect(out).toContain("#adoc-glossary[");
    expect(out).toContain("#adoc-colophon[");
    expect(out).toContain("#adoc-dedication[");
  });
  test("abstract and part intro", async () => {
    const out = await typst("book-parts");
    expect(out).toContain("#adoc-abstract[\nAn abstract.\n]");
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
      '#figure(\n  align(center, image("../fixtures/images/diagram.svg", alt: "A diagram", width: 150pt)),\n  caption: [A captioned image],\n)',
    );
    expect(out).toContain('#box(image("../fixtures/images/diagram.svg", alt: "icon", width: 12pt))');
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

  test("url-only entry", async () => {
    expect(await yaml("bibliography")).toContain('dcm-dev:\n  type: misc\n  url: "https://dcm.dev/"\n');
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
  test("citations", async () => {
    const out = await typst("bibliography");
    expect(out).toContain("Usage in citations @dcm-dev and @doctests, then @apa.");
  });
  test("a citation that runs into following text uses the long form", async () => {
    const out = await typst("bibliography-deep");
    expect(out).toContain("Cited as #cite(<no>)s and, at the end of a sentence, @no. Section:");
  });
  test("lost information is reported, not silent", async () => {
    const out = await typst("bibliography");
    expect(out).toContain(
      "// adoc2typ: list captions are not representable in Hayagriva: Flutter/Dart; Zig; Books",
    );
    expect(out).toContain(
      "custom reference labels are not representable in Hayagriva: dcm-dev (flutter-dcm), doc-comments (zig-doc-comments)",
    );
  });
  test("Typst's generated title replaces the section heading and keeps the id", async () => {
    const out = await typst("bibliography");
    expect(out).not.toContain("= References");
    expect(out).not.toContain("title: none");
    expect(out).toContain(") <_references>\n]");
    expect(out).toContain('the section title "References" is replaced by Typst\'s generated one');
  });
  test("a nested bibliography keeps its heading level", async () => {
    const out = await typst("bibliography-deep");
    expect(out).toContain("#set heading(offset: 2)");
    expect(out).toContain("#link(<_referencias>)[Referencias]");
  });
  test("the YAML is also returned for callers that want a file", async () => {
    const result = await convertFixture("bibliography");
    expect(result.bibliographies).toHaveLength(1);
    expect(result.bibliographies[0]).toStartWith("dcm-dev:\n");
  });
});

describe("real-world documents", () => {
  test("docent: a book with a glossary, nested description lists and a bibliography", async () => {
    const result = await convertFixture("docent");
    expect(result.diagnostics).toEqual([]);
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
