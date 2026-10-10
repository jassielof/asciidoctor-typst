import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { convert } from "../src/convert.ts";
import { decodeEntities, escapeLineStarts, escapeMarkup } from "../src/escape.ts";

type Opts = Parameters<typeof convert>[1];

/** Converts a snippet and returns only the body (everything after the `#show:` header). */
async function body(adoc: string, opts: Opts = {}): Promise<string> {
  const out = (await convert(adoc, opts)).typst;
  const i = out.indexOf("\n)\n");
  return out.slice(i + 3).trim();
}

async function warnings(adoc: string, opts: Opts = {}): Promise<string[]> {
  return (await convert(adoc, opts)).diagnostics.map((d) => d.message);
}

describe("escaping", () => {
  test("markup characters", () => {
    expect(escapeMarkup("a*b_c#d$e@f<g>[h]`~\\")).toBe("a\\*b\\_c\\#d\\$e\\@f\\<g>\\[h\\]\\`\\~\\\\");
  });
  test("hyphen runs and comment starts", () => {
    expect(escapeMarkup("a--b")).toBe("a\\-\\-b");
    expect(escapeMarkup("a//b")).toBe("a\\//b");
    expect(escapeMarkup("x...")).toBe("x\\...");
  });
  test("line starts that would become structure", () => {
    expect(escapeLineStarts("= not heading\n- not list\n1. not enum\n+ plus\n/ term")).toBe(
      "\\= not heading\n\\- not list\n1\\. not enum\n\\+ plus\n\\/ term",
    );
  });
  test("entities", () => {
    expect(decodeEntities("&amp; &#8364; &copy; &#x2014; &unknown;")).toBe("& € © — &unknown;");
  });
});

describe("document header", () => {
  test("title, subtitle, authors, revision and attributes", async () => {
    const out = await convert(
      "= Main: Sub\nJane Doe <jane@x.org>; Bob\nv1.0, 2026-01-01: First\n:doctype: book\n:custom: value\n\nBody.",
    );
    expect(out.typst).toContain("title: [Main]");
    expect(out.typst).toContain("subtitle: [Sub]");
    expect(out.typst).toContain('(name: "Jane Doe", email: "jane@x.org"), (name: "Bob")');
    expect(out.typst).toContain('revision: (number: "1.0", date: "2026-01-01", remark: "First")');
    expect(out.typst).toContain("#show: adoc-book.with(");
    expect(out.typst).toContain('"custom": "value"');
  });
  test("doctype can be forced", async () => {
    expect((await convert("= T\n\nx", { doctype: "book" })).typst).toContain("adoc-book.with");
    expect((await convert("= T\n:doctype: book\n\nx")).typst).toContain("adoc-book.with");
    expect((await convert("= T\n\nx")).typst).toContain("adoc-article.with");
  });
  test("built-in attributes are not leaked to the template", async () => {
    const { typst } = await convert("= T\n:mine: 1\n\nx");
    expect(typst).toContain('"mine": "1"');
    expect(typst).not.toContain("docdate");
    expect(typst).not.toContain("asciidoctor");
  });
});

describe("attributes and conditionals", () => {
  test("references are substituted, missing ones are kept and reported", async () => {
    const src = ":name: World\n\nHello {name} and {nope}.";
    expect(await body(src)).toBe("Hello World and {nope}.");
    expect((await warnings(src)).join()).toContain("nope");
  });
  test("ifdef / ifndef / ifeval", async () => {
    const src = [
      ":a:",
      "ifdef::a[]\nA is set\nendif::[]",
      "ifndef::a[]\nA is unset\nendif::[]",
      "ifdef::a,b[]\nany\nendif::[]",
      "ifdef::a+b[]\nall\nendif::[]",
      ":n: 3",
      "ifeval::[{n} > 2]\nbig\nendif::[]",
      "ifdef::a[inline]",
    ].join("\n\n");
    const out = await body(src);
    expect(out).toContain("A is set");
    expect(out).not.toContain("A is unset");
    expect(out).toContain("any");
    expect(out).not.toContain("all");
    expect(out).toContain("big");
    expect(out).toContain("inline");
  });
  test("caller attributes win; backend-pdf is defined", async () => {
    expect(await body("{x}", { attributes: { x: "cli" } })).toBe("cli");
    expect(await body("ifdef::backend-pdf[]\nyes\nendif::[]")).toBe("yes");
  });
  test("counters and escapes", async () => {
    expect(await body("{counter:n} {counter:n} \\{n}")).toBe("1 2 {n}");
  });
});

describe("includes", () => {
  const dir = mkdtempSync(join(tmpdir(), "adoc2typ-inc-"));
  writeFileSync(join(dir, "ch.adoc"), "= Chapter\n\nIn chapter.\n\n== Inner\n\nText.");
  writeFileSync(join(dir, "tagged.adoc"), "before\n// tag::a[]\ninside\n// end::a[]\nafter");
  const opts = { file: join(dir, "main.adoc") };
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  test("leveloffset shifts included headings and is restored", async () => {
    const out = await body("= Book\n:doctype: book\n\ninclude::ch.adoc[leveloffset=+1]\n\n== After", opts);
    expect(out).toContain("= Chapter <_chapter>");
    expect(out).toContain("== Inner");
    expect(out).toContain("= After");
  });
  test("tags and lines", async () => {
    expect(await body("include::tagged.adoc[tag=a]", opts)).toBe("inside");
    expect(await body("include::tagged.adoc[lines=1]", opts)).toBe("before");
  });
  test("missing include warns", async () => {
    expect((await warnings("include::nope.adoc[]", opts)).join()).toMatch(/include file not found|nope/i);
  });
});

describe("inline", () => {
  test("quotes", async () => {
    expect(await body("*b* _i_ `m` #h# ^s^ ~u~ **un**constrained")).toBe(
      '#strong[b] #emph[i] #raw("m") #highlight[h] #super[s] #sub[u] #strong[un]constrained',
    );
  });
  test("constrained marks ignore snake_case and math-like text", async () => {
    expect(await body("snake_case_name and 2*3*4")).toBe("snake\\_case\\_name and 2\\*3\\*4");
  });
  test("nesting and roles", async () => {
    expect(await body("*_both_*")).toBe("#strong[#emph[both]]");
    expect(await body("[.underline]#u#")).toContain("#underline[");
    expect(await body("[.big]#wide#")).toBe('#adoc-role(("big",))[wide]');
  });
  test("links, autolinks, email", async () => {
    expect(await body("https://a.b/c[text] https://a.b/d. user@example.org link:x.html[x]")).toBe(
      '#link("https://a.b/c")[text] #link("https://a.b/d"). #link("mailto:user@example.org")[user\\@example.org] #link("x.html")[x]',
    );
  });
  test("text directly after a code expression cannot become a call chain", async () => {
    expect(await body("*b*.foo and *c*(x)")).toBe("#strong[b]\\.foo and #strong[c]\\(x)");
  });
  test("passthroughs and escapes", async () => {
    expect(await body("+*not bold*+ \\*x* ++a_b_c++")).toBe("\\*not bold\\* \\*x\\* a\\_b\\_c");
  });
  test("curly quotes and typographic replacements", async () => {
    expect(await body("\"`quoted`\" and '`single`'")).toBe("“quoted” and ‘single’");
    expect(await body("(C) 2026 -> ok... it's")).toBe("© 2026 → ok\\.\\.\\.​ it’s".replace("\\.\\.\\.", "…"));
  });
  test("footnotes, kbd, menu, stem", async () => {
    expect(await body("a footnote:[note] b")).toBe("a #footnote[note] b");
    expect(await body(":experimental:\n\nkbd:[Ctrl+Alt+Del] menu:File[Save As]")).toContain(
      '#adoc-kbd("Ctrl", "Alt", "Del")',
    );
    expect(await body(":experimental:\n\nkbd:[Ctrl+Alt+Del] menu:File[Save As]")).toContain(
      '#adoc-menu("File", "Save As")',
    );
    expect(await body("stem:[x^2]")).toBe('#adoc-math("asciimath", "x^2")');
    expect(await body(":stem: latexmath\n\nstem:[x^2]")).toBe('#adoc-math("latexmath", "x^2")');
  });
  test("hard line breaks", async () => {
    expect(await body("one +\ntwo")).toBe("one\\\ntwo");
  });
  test("footnote reuse", async () => {
    const out = await body("a footnote:n[Note] b footnote:n[]");
    expect(out).toBe("a #footnote[Note]<fn-n> b #footnote(<fn-n>)");
  });
});

describe("blocks", () => {
  test("sections become headings and shift under parts", async () => {
    const flat = await body("= B\n:doctype: book\n\n== Ch\n\n=== Sec\n\ntext");
    expect(flat).toContain("= Ch <_ch>");
    expect(flat).toContain("== Sec <_sec>");
    const parts = (await convert("= B\n:doctype: book\n\n= Part\n\n== Ch\n\ntext")).typst;
    expect(parts).toContain("parts: true");
    expect(parts).toContain("= Part <_part>");
    expect(parts).toContain("== Ch <_ch>");
  });
  test("automatic ids are de-duplicated", async () => {
    const out = await body("== Same\n\n== Same\n");
    expect(out).toContain("<_same>");
    expect(out).toContain("<_same_2>");
  });
  test("special sections wrap their content", async () => {
    expect(await body("[preface]\n== Intro\n\ntext")).toBe("#adoc-preface[\n= Intro <_intro>\n\ntext\n]");
    expect(await body("[appendix]\n== Extra\n\ntext")).toContain("#adoc-appendix[");
  });
  test("nested and ordered lists, continuation", async () => {
    const out = await body("* a\n** b\n* c\n+\nattached\n\n//-\n\n. one\n. two");
    expect(out).toBe("- a\n  - b\n- c\n\n  attached\n\n+ one\n+ two");
  });
  test("a list of a different kind after a blank line nests (AsciiDoc semantics)", async () => {
    expect(await body("* c\n\n. one")).toBe("- c\n  + one");
  });
  test("adjacent lists of the same kind are separated", async () => {
    expect(await body("* a\n\n//-\n\n* b")).toContain("#v(0pt, weak: true)");
  });
  test("description lists, nested and with multiple terms", async () => {
    const out = await body("A::\nB:: desc\nOuter::\nInner::: nested");
    expect(out).toBe("/ A#linebreak()B: desc\n/ Outer:\n  / Inner: nested");
  });
  test("admonitions", async () => {
    expect(await body("NOTE: careful")).toBe('#adoc-admonition("note")[\ncareful\n]');
    expect(await body(".Title\n[WARNING]\n====\nbad\n====")).toBe(
      '#adoc-admonition("warning", title: [Title])[\nbad\n]',
    );
  });
  test("source blocks, callouts and list", async () => {
    const out = await body("[source,zig]\n----\nconst a = 1; // <1>\n----\n<1> Explained");
    expect(out).toContain('adoc-callout-code(lang: "zig", callouts: ((0, 1),), "const a = 1;")');
    expect(out).toContain("#adoc-callout-list(([Explained],))");
  });
  test("listing keeps content verbatim", async () => {
    const out = await body("----\n= not a heading\n*not bold*\n<tag> & more\n----");
    expect(out).toBe('#raw(block: true, "= not a heading\\n*not bold*\\n<tag> & more")');
  });
  test("tables: header, spans, alignment", async () => {
    const out = await body('[cols="1,2"]\n|===\n|A |B\n\n2+^|span\n|x |y\n|===');
    expect(out).toContain("columns: (1fr, 2fr)");
    expect(out).toContain("table.header([A], [B])");
    expect(out).toContain("table.cell(colspan: 2, align: center)[span]");
  });
  test("asciidoc table cells nest blocks", async () => {
    const out = await body('[cols="1a"]\n|===\n|\n* one\n* two\n|===');
    expect(out).toContain("- one");
    expect(out).toContain("- two");
  });
  test("block title becomes figure caption", async () => {
    const out = await body(".Cap\n|===\n|a\n|===");
    expect(out).toContain("#figure(");
    expect(out).toContain("caption: [Cap]");
  });
  test("quotes, verse, sidebar", async () => {
    expect(await body("[quote, Author, Source]\n____\nText\n____")).toBe(
      "#quote(block: true, attribution: [Author, Source])[\nText\n]",
    );
    expect(await body("****\nside\n****")).toBe("#adoc-sidebar()[\nside\n]");
    expect(await body("[verse, A]\n____\nl1\nl2\n____")).toBe("#adoc-verse(attribution: [A])[\nl1 \\\nl2\n]");
  });
  test("image block", async () => {
    expect(await body(".Cap\nimage::a.png[Alt,100]")).toBe(
      '#figure(\n  image("a.png", alt: "Alt", width: 75pt),\n  caption: [Cap],\n)',
    );
  });
  test("comments are dropped", async () => {
    expect(await body("a\n\n// line\n\n////\nblock\n////\n\nb")).toBe("a\n\nb");
  });
  test("typst passthrough blocks are emitted verbatim", async () => {
    expect(await body("[typst]\n++++\n#lorem(3)\n++++")).toBe("#lorem(3)");
  });
});

describe("cross references", () => {
  test("resolved and unresolved", async () => {
    const out = await body("== Target\n\nSee <<_target>> and <<_target,custom>> and <<nope>>.");
    expect(out).toContain("#link(<_target>)[Target]");
    expect(out).toContain("#link(<_target>)[custom]");
    expect((await warnings("See <<nope>>.")).join()).toContain("unresolved cross reference: nope");
  });
  test("references to bibliography entries become citations", async () => {
    const out = await body("See <<b1>>, <<b1,custom>>.\n\n[bibliography]\n== Refs\n\n* [[[b1]]] A book.");
    expect(out).toStartWith("See @b1, @b1.");
    expect(out).toContain("#bibliography(");
  });
});

describe("bibliography", () => {
  const yamlOf = async (adoc: string) => (await convert(adoc)).bibliographies[0] ?? "";
  const section = (entries: string) => `[bibliography]\n== References\n\n${entries}\n`;

  test("url-only entry", async () => {
    expect(await yamlOf(section("* [[[a]]] https://dcm.dev/."))).toBe(
      'a:\n  type: misc\n  url: "https://dcm.dev/"\n',
    );
  });
  test("title and url, attributes substituted", async () => {
    const yaml = await yamlOf(
      ":v: 0.16.0\n\n" + section("* [[[d]]] Doctests in the Zig docs — https://z.org/{v}/#Doctests"),
    );
    expect(yaml).toBe(
      'd:\n  type: misc\n  title: "Doctests in the Zig docs"\n  url: "https://z.org/0.16.0/#Doctests"\n',
    );
  });
  test("author, year and italic title", async () => {
    const yaml = await yamlOf(section("* [[[c]]] Estado Plurinacional. (2009). _Constitución_. Gaceta."));
    expect(yaml).toBe(
      'c:\n  type: misc\n  author:\n    name: "Estado Plurinacional"\n  date: 2009\n  title: "Constitución"\n  note: "Gaceta"\n',
    );
  });
  test("unstructured entries keep their whole text as the title", async () => {
    const yaml = await yamlOf(section("* [[[g]]] Gamma et al. Design Patterns. 1994."));
    expect(yaml).toContain('title: "Gamma et al. Design Patterns. 1994"');
  });
  test("entries without an anchor get generated keys; nested items become notes", async () => {
    const yaml = await yamlOf(section("* No anchor here.\n* [[[n]]] Outer.\n** Inner detail."));
    expect(yaml).toContain("ref-1:");
    expect(yaml).toContain('note: "Inner detail."');
  });
  test("custom labels and list captions are reported, not silently lost", async () => {
    const out = await body(section(".Caption\n* [[[a,lbl]]] Entry."));
    expect(out).toContain("// adoc2typ: list captions are not representable in Hayagriva: Caption");
    expect(out).toContain("custom reference labels are not representable in Hayagriva: a (lbl)");
  });
  test("keys that YAML would misread are quoted", async () => {
    expect(await yamlOf(section("* [[[no]]] Entry."))).toStartWith('"no":');
  });
  test("citation followed by text uses the long form", async () => {
    const out = await body("<<a>>s and <<a>>.\n\n" + section("* [[[a]]] Entry."));
    expect(out).toStartWith("#cite(<a>)s and @a.");
  });
  test("the generated bibliography title replaces the section heading", async () => {
    const out = await body(":lang: es\n\nSee <<_refs>>.\n\n[bibliography]\n== Refs\n\n* [[[a]]] Entry.");
    expect(out).not.toContain("= Refs");
    expect(out).not.toContain("title: none");
    expect(out).toContain("#link(<_refs>)[Refs]");
    expect(out).toMatch(/\) <_refs>\n\]$/);
    expect(out).toContain('the section title "Refs" is replaced');
  });
  test("a deeper bibliography keeps its heading level", async () => {
    const out = await body("== Chapter\n\n=== Sub\n\n[bibliography]\n==== Refs\n\n* [[[a]]] Entry.");
    expect(out).toContain("#set heading(offset: 2)");
  });
});
