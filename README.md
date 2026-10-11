# AsciiDoc to Typst converter

Converts AsciiDoc to Typst. Parsing is done by the official
[`@asciidoctor/core`](https://github.com/asciidoctor/asciidoctor.js) library, so all AsciiDoc
semantics (includes, conditionals, attribute substitution, list/table/section rules, ids,
xrefs, callouts, footnotes) are exactly Asciidoctor's. This project only maps Asciidoctor's
AST to Typst; there is no intermediate format (no DocBook, no HTML).

```
.adoc ── Asciidoctor (load) ──► AST ──► TypstEmitter ──► .typ  (+ packages/core/template/lib.typ)
                 │                          ▲
                 └─ inline subs ─► TypstInlineConverter (custom "typst" backend)
```

- `packages/core/src/inline.ts` – a custom Asciidoctor converter for the `typst` backend. It handles every
  _inline_ node (strong, emphasis, links, xrefs, footnotes, images, kbd, …). Its output is
  token-protected so Typst code survives Asciidoctor's later substitution passes and text is
  entity-decoded and escaped for Typst exactly once.
- `packages/core/src/emit.ts` – walks the block AST (sections, lists, tables, listings, …) and writes Typst.
- `packages/core/src/escape.ts` – Typst escaping (markup, strings, labels, line starts).
- `packages/core/src/bibliography.ts` – turns `[bibliography]` sections into Hayagriva (see below).
- `packages/core/src/convert.ts` – glue: options, loading, diagnostics, header attributes.

## Installation

The package is not published to npm; install it straight from the repository (it needs [Bun](https://bun.sh)):

```sh
bun add -g github:jassielof/asciidoctor-typst   # the asciidoctor-typst command, globally
bun add github:jassielof/asciidoctor-typst      # or as a library dependency of a project
```

Both give the `asciidoctor-typst` command (`bunx asciidoctor-typst doc.adoc` works too) and `import { convert, compileToPdf } from "asciidoctor-typst"`. A tag or commit can be pinned with `github:jassielof/asciidoctor-typst#v0.1.0`.

## Project layout

One installable package, `asciidoctor-typst` (the root), made of two workspace packages:

```
packages/
├── core/   @asciidoctor-typst/core: the library (conversion, bundle writer, in-process compilation),
│           the Typst template (template/), fonts (assets/) and the tests (tests/)
└── cli/    @asciidoctor-typst/cli: the command line, built on the library with commander
```

The root `package.json` exposes the library as the package's entry point and the CLI as its `asciidoctor-typst` binary, and lists their runtime dependencies, because a git install does not install the workspaces of a dependency. The CLI only parses arguments and calls the library; anything else (including the compile step) lives in `core`, so it can be used from code without a shell.

## Usage

By default the document is compiled to PDF in-process with [typst.ts](https://github.com/Myriad-Dreamin/typst.ts); the Typst CLI is not needed.

```sh
asciidoctor-typst packages/core/tests/fixtures/docent.adoc              # writes docent.pdf next to it
asciidoctor-typst packages/core/tests/fixtures/docent.adoc -o out/docent.pdf
```

To control how Typst compiles (project root, font paths, system fonts, PDF standard, …), write the Typst source with `--typst` and compile it with your own Typst CLI:

```sh
asciidoctor-typst packages/core/tests/fixtures/docent.adoc --typst -o out/docent
typst compile --root packages/core out/docent/main.typ
```

| Option                                   | Meaning                                                                                   |
| ---------------------------------------- | ----------------------------------------------------------------------------------------- |
| `-o, --output <path>`                    | The PDF to write (default: `<input>.pdf`). With `--typst`: the directory for the project. |
| `--typst`                                | Write the Typst source instead of compiling it.                                           |
| `-a, --attribute name[=value]` / `name!` | Set / unset a document attribute (repeatable).                                            |
| `-d, --doctype book\|article`            | Force the doctype.                                                                        |
| `--lib <path>`                           | Import path of the template library (default `/template/lib.typ`).                        |
| `--strict`                               | Exit non-zero if any warning was reported.                                                |

In-process compilation has fixed settings: the fonts in `packages/core/assets/fonts` plus typst.ts' default font assets (text, CJK, emoji, math), and the template library resolved as `/template/...`. Packages (`@preview/...`) and the default fonts are downloaded on first use; packages are cached in `~/.cache/asciidoctor-typst/packages`.

With `--typst` the output is a **directory** that Typst can compile on its own:

```
out/docent/
├── main.typ            the document (imports the template library)
├── bibliography.yaml   Hayagriva YAML, one file per [bibliography] section
└── images/             every local image the document uses, copied
```

Image paths in `main.typ` are relative to it. With `--typst` and without `-o`, `main.typ` is printed to stdout, which only works for documents that need no other file.

Programmatic use of the compile step: `await compileToPdf(result, { lib })` (from `asciidoctor-typst`) takes a conversion result and returns the PDF bytes; it throws a `CompileError` (`messages`) when Typst rejects the document.

Programmatic use: `await convert(source, options)` / `await convertFile(path, options)` from `asciidoctor-typst` (the Asciidoctor API is async) return
`{ typst, files, bibliographies, diagnostics, document }`. `files` is the bundle: entries with
`content` are generated, entries with `source` are copied (`writeFiles(dir, files)` does both).

Diagnostics combine Asciidoctor's own warnings (missing includes, undefined attributes,
unterminated blocks, …) with the converter's (unresolved xrefs, remote images, unsupported
media, HTML passthroughs). The conversion runs in Asciidoctor's `safe` mode with the source
directory as the include jail (`baseDir` option to change it).

## Output contract

Native Typst is used wherever Typst can express the construct. Everything else calls an
`adoc-*` function from `packages/core/template/lib.typ`, which is where styling lives.

| AsciiDoc                                                     | Typst                                                                                                                         |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| document header                                              | `#show: adoc-book.with(title:, subtitle:, authors:, revision:, logo:, parts:, attributes:)` (or `adoc-article`)               |
| `[abstract]` section / block / titled paragraph              | `#abstract(title: [...])[...]` / `#abstract(style: "block")[...]` / `#abstract(style: "block", title: [...])[...]`            |
| `[colophon]`                                                 | `#colophon(title: [...])[...]` (`level:` only when not 1); the function draws the heading                                     |
| `[bibliography]`                                             | a bare `#bibliography(full: true, "bibliography.yaml")` (no wrapper, no label)                                                |
| sections                                                     | `=` headings. In a book with parts: part `=`, chapter `==`, section `===` (`parts: true`)                                     |
| `[preface]`, `[appendix]`, `[glossary]`, …                   | `#adoc-preface[ … ]`, `#adoc-appendix[ … ]`, … around the heading and its content                                             |
| `[abstract]`, `[partintro]`                                  | `#adoc-abstract[…]`, `#adoc-partintro[…]`                                                                                     |
| `[discrete]` headings                                        | `#heading(outlined: false, numbering: none)`                                                                                  |
| `*`, `.` lists, checklists                                   | `-`, `+` lists (`#set enum(numbering:)` for `a.`/`i)` styles)                                                                 |
| description lists                                            | `/ term: …`                                                                                                                   |
| callout lists                                                | `#adoc-callout-list(( … ))`                                                                                                   |
| source/listing/literal                                       | `#raw(block: true, lang:, "…")` (one string, so indentation can never corrupt it)                                             |
| callouts in source                                           | `#adoc-callout-code(lang:, callouts: ((line, n), …), "…")`                                                                    |
| tables                                                       | `#table(columns:, table.header(…), …)`, `table.cell(colspan:, rowspan:, align:)`                                              |
| titled table/image/listing                                   | `#figure(…, caption: […])`                                                                                                    |
| `image::` / `image:`                                         | `#image(…)` / `#box(image(…))`                                                                                                |
| `NOTE:` etc.                                                 | `#adoc-admonition("note", title: […])[…]`                                                                                     |
| quote / verse / sidebar / example                            | `#quote(block: true, attribution:)`, `#adoc-verse`, `#adoc-sidebar`, `#adoc-example`                                          |
| block titles on other blocks                                 | `#adoc-block-title[…]`                                                                                                        |
| `<<id>>`, `xref:`                                            | `#link(<id>)[title]` (title resolved by Asciidoctor)                                                                          |
| `footnote:` / `footnote:id[]`                                | `#footnote[…]<fn-id>` / `#footnote(<fn-id>)`                                                                                  |
| anchors, `[[[bib]]]`                                         | `#metadata(none)<id>`                                                                                                         |
| `kbd:`, `btn:`, `menu:` (need `:experimental:`), index terms | `#adoc-kbd`, `#adoc-btn`, `#adoc-menu`, `#adoc-indexterm`                                                                     |
| `stem:[]`, `latexmath:[]` / `[stem]`, `[latexmath]` blocks   | `#mi("<raw LaTeX>")` / `#mitex("<raw LaTeX>")` (the mitex package, called directly); with `:stem: typstmath`: `$x$` / `$ x $` |
| roles `[.role]#x#`                                           | `#adoc-role(("role",))[x]` (`underline`/`line-through` map to Typst natively)                                                 |
| `toc::[]`, `<<<`, `'''`                                      | `#outline()`, `#pagebreak()`, `#line(length: 100%)`                                                                           |
| `[typst]` + `++++`                                           | emitted verbatim (raw Typst)                                                                                                  |

Every attribute the document or caller set is passed as `attributes: ("toc": "", "sectnums": "", …)`, so the template can react to `:toc:`, `:sectnums:`, custom attributes, etc. Asciidoctor's built-ins are filtered out, and so is anything that already has its own argument (`revision`, `logo`, `lang`) or means nothing for Typst (below).
`backend-typst` and **`backend-pdf`** are defined, so `ifdef::backend-pdf[]` blocks written for
asciidoctor-pdf apply.

## Math

Only **LaTeX** math is supported, rendered by the [mitex](https://typst.app/universe/package/mitex) package: the formula is passed as the raw TeX, exactly as written, to mitex's own functions: `#mi("\\frac{a}{b}")` inline and `#mitex("…")` for blocks. The template library imports them, so there is no wrapper. `stem:[]` and `[stem]` mean LaTeX when `:stem:` is not set.

AsciiMath is **refused**: Typst has no AsciiMath and mitex only reads LaTeX, so `asciimath:[]`, `[asciimath]` blocks and `:stem: asciimath` (or an empty `:stem:`, which means AsciiMath in Asciidoctor) make the conversion fail with an error instead of producing a formula that cannot render. Typst's own math syntax is available only through non-standard AsciiDoc, below.

### Typst math (non-standard)

AsciiDoc only knows `latexmath` and `asciimath`. For documents written for this converter only, `:stem: typstmath` (or `-a stem=typstmath`) makes `stem:[]` and `[stem]` blocks Typst math: `stem:[sum_(i=1)^n i]` becomes `$sum_(i=1)^n i$` and a `[stem]` block `$ … $`. Explicit `latexmath` stays LaTeX; the explicit `asciimath` forms are read as Typst math too, since Asciidoctor cannot tell them apart. Because this is not AsciiDoc, other processors will not render such a document, and the conversion always reports a warning (`:stem: typstmath is not standard AsciiDoc`), which `--strict` turns into a failure.

## Ignored attributes

Typst highlights code itself and the math syntax is chosen by the converter, so `:source-highlighter:` and `:stem:` mean nothing: they are not passed to the template and not stored in a state. An attribute that is **not referenced** anywhere is reported (`attribute :stem: is ignored (math is always LaTeX)`); one that **is** referenced (`{source-highlighter}`) is simply replaced by its value, as Asciidoctor does, with no warning.

## Authors, revision, language and the title page

The header information Asciidoctor derives is passed to the template as data, each piece once:

```typst
#show: adoc-book.with(
  authors: (
    (name: "Jassiel Ovando_F.", email: "…"),
    (name: "Vivienne Y."),
  ),
  revision: (number: "1.0", date: "2026-10-12", remark: "…", label: "Versión"),
  logo: (image: image("images/logo.svg", width: 25%)),
  lang: "es",
  …
)
```

Information that has its own argument is **not repeated** in `attributes` (`version-label`,
`title-logo-image`, `lang`), and the document type is the wrapper itself (`adoc-book` /
`adoc-article`), so `doctype` is not repeated either. `attributes` holds the rest (`toc`,
`sectnums`, custom attributes, …).

- **Authors** follow the [AsciiDoc rules](https://docs.asciidoctor.org/asciidoc/latest/document/author-information/):
  one or many on the author line (`A <a@x>; B`), or one through `:author:`/`:email:`/… attributes.
  An author is only `name` (as written, `_` joining the words of one name) and `email`. The first,
  middle and last name and the initials are **derived by the library** from the name
  (`parse-author` in `lib/authorship.typ`, same rules as AsciiDoc: at most three names, a longer
  name is kept whole as the first name), and stored in the `authors` state. Explicit keys in the
  dictionary win over the derived ones.
- **Revision** is `revnumber`, `revdate`, `revremark` plus `version-label` (the text before the
  number). `lib/version.typ` formats it like Asciidoctor PDF (`Versión 1.0, 2026-10-12`, then the
  remark) and keeps it in the `revision` state.
- **Language and document type** are kept in the states of `lib/document-info.typ`; `lang` is also
  what `text(lang:)` is set to, so generated titles (the bibliography's) follow it.
- **References in the body** are **not** replaced by their value: `{lastname_2}`,
  `{authorinitials_1}`, `{authors}`, `{authorcount}`, `{revnumber}`, `{revdate}`, `{revremark}`,
  `{version-label}`, `{lang}` and `{doctype}` become lookups into those states
  (`#author-field(n: 2, field: "lastname")`, `#author-names()`, `#revision-field("number")`,
  `#document-lang()`, …). Changing an author, the revision or the language on the Typst side (the
  wrapper's arguments, or `set-authors` / `set-revision` / `set-document-info`) therefore changes
  every reference. This is done by intercepting Asciidoctor's attribute substitution, so it applies
  wherever Asciidoctor would substitute (paragraphs, titles, list items, table cells, included
  files) and not inside verbatim blocks or `ifeval`. A reference that lands inside a Typst _string_
  (a URL, an alt text, the `attributes` dictionary, YAML) cannot be a lookup and gets the current
  value; `\{lastname_1}` stays literal, as in AsciiDoc.
- The library exposes getters for the template and the document: `author-field`, `author-name`,
  `author-firstname`, `author-middlename`, `author-lastname`, `author-initials`, `author-email`,
  `author-names`, `author-count`, `revision-field`, `document-lang`, `document-doctype`.
- **Title page** (`lib/title-page.typ`) follows Asciidoctor PDF's `title_page` theme: right-aligned,
  logo 10% down, title block 55% down with the theme's proportions (title 2.6x in `999999`, subtitle
  1.7x bold italic directly under it, authors 1.25x, revision body size, 1.25x gaps) and no other
  spacing.
- **Title logo** (`:title-logo-image: image:logo.svg[pdfwidth=25%]`) is bundled into `images/` and
  passed as an `image(...)` call built _in the document_: Typst resolves image paths relative to
  the file that calls `image`, so a bare path handed to the template would be looked up next to it.
- **Dates**: `{docdate}` and friends come from the source file's modification time. Set
  `SOURCE_DATE_EPOCH` for reproducible output (the tests do).

## Bibliographies

AsciiDoc has a very small bibliography syntax
([spec](https://docs.asciidoctor.org/asciidoc/latest/sections/bibliography/)): a section with the
`bibliography` style, list items starting with a `[[[id]]]` or `[[[id,xreftext]]]` anchor, and
`<<id>>` citations. Typst uses [Hayagriva](https://github.com/typst/hayagriva), so such a
section is converted on a best-effort basis:

```asciidoc
Usage in citations <<dcm-dev>> and <<doctests,customlabeled>>.

[bibliography]
== References

.Zig
* [[[dcm-dev,flutter-dcm]]] https://dcm.dev/.
* [[[doctests]]] Doctests in the Zig documentation — https://ziglang.org/documentation/{zig-version}/#Doctests
```

becomes

```typst
Usage in citations @dcm-dev and @doctests.

#bibliography(full: true, "bibliography.yaml")
```

```yaml
# Zig
dcm-dev: # AsciiDoc label: flutter-dcm
  type: misc
  url: "https://dcm.dev/"
doctests:
  type: misc
  title: "Doctests in the Zig documentation"
  url: "https://ziglang.org/documentation/0.16.0/#Doctests"
```

- The Hayagriva YAML is **a file next to `main.typ`** (`bibliography.yaml`, `bibliography-2.yaml`, …),
  referenced by path. It is also returned as `ConvertResult.bibliographies`.
- Attribute references (`{zig-version}`) are already substituted by Asciidoctor.
- Fields are inferred from the entry text: `Author. (2009). _Title_. Rest.` gives `author`,
  `date`, `title` and `note`; `Title — https://…` gives `title` and `url`; a bare URL gives only
  `url`; anything else keeps its whole text as `title`. Nested list items are appended to `note`.
  Entries without an anchor are still listed (key `ref-N`).
- Citations of exported entries become `@key` (or `#cite(<key>)` where the key would run into
  following text).
- **Not representable in Hayagriva, kept as YAML comments**: list captions become a comment above
  their group of entries (`# Zig`), and custom reference labels (`[[[id,label]]]`) a comment on the
  entry (`# AsciiDoc label: label`). Custom citation text (`<<id,text>>`) is the only thing lost.
- **The section heading is replaced by Typst's generated bibliography title**, which follows the
  document language (`:lang:` becomes `set text(lang:)` in the template), e.g. _Bibliografía_. It is
  emitted at the section's level (`#set heading(offset: …)`). The call is bare: no wrapper function
  and no label (nor on the colophon), so a cross reference to such a section is plain text. The
  AsciiDoc title text is reported in the comment above the call. Style (numeric, author-date, …) is chosen in the template
  via `#bibliography(style:)`.

## Known limits

- `video::`/`audio::` become links; remote images (URLs) become links (Typst cannot fetch).
- Inline passthroughs (`+++…+++`, `pass:[]`) arrive as plain text (Asciidoctor restores them
  before converters see them), so they are escaped rather than emitted as raw Typst. Use a
  `[typst]` `++++` block for raw Typst. HTML block passthroughs are dropped with a warning.
- Math is LaTeX (or, non-standard, Typst math with `:stem: typstmath`); AsciiMath is not supported.
- Description list styles (`[horizontal]`, `[qanda]`) and list numbering styles beyond
  arabic/alpha/roman are not mapped.
- Typst merges adjacent lists of the same kind; the emitter inserts an inert
  `#v(0pt, weak: true)` between them.
- `@asciidoctor/core` 4.x is a recent native-JS port of Asciidoctor (Node ≥ 24 per its
  README; it runs under Bun). Its API is async and may still change between releases.

## Development

```sh
bun test                       # unit tests + snapshots (+ compiles every snapshot with typst)
UPDATE_SNAPSHOTS=1 bun test    # rewrite snapshots; review the diff before committing
bun run check                  # typecheck, lint, format check and tests
```

Layout:

- `packages/core/tests/fixtures/` – the AsciiDoc inputs: small ones per feature area (`lists.adoc`, `tables.adoc`,
  `bibliography.adoc`, …), a multi-file one (`includes/main.adoc`) and two real-world documents
  (`docent.adoc`, `upsa-regulations.adoc`).
- `packages/core/tests/snapshots/` – the expected output of every fixture (`<fixture>/main.typ`, the YAML), plus
  `diagnostics.txt` where it is expected to warn. Each snapshot is also compiled with
  `typst` to prove it is valid.
- `packages/core/tests/snapshots.test.ts` – compares every fixture with its snapshot and compiles it.
- `packages/core/tests/convert.test.ts` – behavioural assertions, also driven by the fixtures, so a failure points
  at one behaviour instead of a whole-file diff.
- `packages/core/tests/escape.test.ts` – pure unit tests of the escaping helpers.
- `packages/core/tests/compile.test.ts` – in-process PDF compilation (needs network on first use).
- `packages/cli/tests/cli.test.ts` – the command line.
- `packages/core/tests/fixtures.ts` – fixture discovery and conversion shared by the test files.

To add a case: drop an `.adoc` in `packages/core/tests/fixtures/`, run `UPDATE_SNAPSHOTS=1 bun test`, review the new
snapshot, and add assertions to `convert.test.ts` if it exercises new behaviour.

## License

[Mozilla Public License 2.0](LICENSE.txt).
