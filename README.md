# AsciiDoc to Typst converter

Converts AsciiDoc to Typst. Parsing is done by the official
[`@asciidoctor/core`](https://github.com/asciidoctor/asciidoctor.js) library, so all AsciiDoc
semantics (includes, conditionals, attribute substitution, list/table/section rules, ids,
xrefs, callouts, footnotes) are exactly Asciidoctor's. This project only maps Asciidoctor's
AST to Typst; there is no intermediate format (no DocBook, no HTML).

```
.adoc ── Asciidoctor (load) ──► AST ──► TypstEmitter ──► .typ  (+ template/lib.typ)
                 │                          ▲
                 └─ inline subs ─► TypstInlineConverter (custom "typst" backend)
```

- `src/inline.ts` – a custom Asciidoctor converter for the `typst` backend. It handles every
  _inline_ node (strong, emphasis, links, xrefs, footnotes, images, kbd, …). Its output is
  token-protected so Typst code survives Asciidoctor's later substitution passes and text is
  entity-decoded and escaped for Typst exactly once.
- `src/emit.ts` – walks the block AST (sections, lists, tables, listings, …) and writes Typst.
- `src/escape.ts` – Typst escaping (markup, strings, labels, line starts).
- `src/bibliography.ts` – turns `[bibliography]` sections into Hayagriva (see below).
- `src/convert.ts` – glue: options, loading, diagnostics, header attributes.

## Usage

```sh
bun src/index.ts tests/fixtures/docent.adoc -o out/docent.typ
typst compile --root . out/docent.typ
```

| Option                                   | Meaning                                                                 |
| ---------------------------------------- | ----------------------------------------------------------------------- |
| `-o, --output <file>`                    | Output file (default: stdout). Relative image paths are re-based to it. |
| `-a, --attribute name[=value]` / `name!` | Set / unset a document attribute (repeatable).                          |
| `-d, --doctype book\|article`            | Force the doctype.                                                      |
| `--lib <path>`                           | Import path of the template library (default `/template/lib.typ`).      |
| `--strict`                               | Exit non-zero if any warning was reported.                              |

Programmatic use: `await convert(source, options)` / `await convertFile(path, options)` from
`src/convert.ts` (the Asciidoctor API is async) return `{ typst, bibliographies, diagnostics, document }`.

Diagnostics combine Asciidoctor's own warnings (missing includes, undefined attributes,
unterminated blocks, …) with the converter's (unresolved xrefs, remote images, unsupported
media, HTML passthroughs). The conversion runs in Asciidoctor's `safe` mode with the source
directory as the include jail (`baseDir` option to change it).

## Output contract

Native Typst is used wherever Typst can express the construct. Everything else calls an
`adoc-*` function from `template/lib.typ`, which is where styling lives.

| AsciiDoc                                                              | Typst                                                                                                    |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| document header                                                       | `#show: adoc-book.with(title:, subtitle:, authors:, revision:, parts:, attributes:)` (or `adoc-article`) |
| sections                                                              | `=` headings. In a book with parts: part `=`, chapter `==`, section `===` (`parts: true`)                |
| `[preface]`, `[appendix]`, `[glossary]`, …                            | `#adoc-preface[ … ]`, `#adoc-appendix[ … ]`, … around the heading and its content                        |
| `[abstract]`, `[partintro]`                                           | `#adoc-abstract[…]`, `#adoc-partintro[…]`                                                                |
| `[discrete]` headings                                                 | `#heading(outlined: false, numbering: none)`                                                             |
| `*`, `.` lists, checklists                                            | `-`, `+` lists (`#set enum(numbering:)` for `a.`/`i)` styles)                                            |
| description lists                                                     | `/ term: …`                                                                                              |
| callout lists                                                         | `#adoc-callout-list(( … ))`                                                                              |
| source/listing/literal                                                | `#raw(block: true, lang:, "…")` (one string, so indentation can never corrupt it)                        |
| callouts in source                                                    | `#adoc-callout-code(lang:, callouts: ((line, n), …), "…")`                                               |
| tables                                                                | `#table(columns:, table.header(…), …)`, `table.cell(colspan:, rowspan:, align:)`                         |
| titled table/image/listing                                            | `#figure(…, caption: […])`                                                                               |
| `image::` / `image:`                                                  | `#image(…)` / `#box(image(…))`                                                                           |
| `NOTE:` etc.                                                          | `#adoc-admonition("note", title: […])[…]`                                                                |
| quote / verse / sidebar / example                                     | `#quote(block: true, attribution:)`, `#adoc-verse`, `#adoc-sidebar`, `#adoc-example`                     |
| block titles on other blocks                                          | `#adoc-block-title[…]`                                                                                   |
| `<<id>>`, `xref:`                                                     | `#link(<id>)[title]` (title resolved by Asciidoctor)                                                     |
| `footnote:` / `footnote:id[]`                                         | `#footnote[…]<fn-id>` / `#footnote(<fn-id>)`                                                             |
| anchors, `[[[bib]]]`                                                  | `#metadata(none)<id>`                                                                                    |
| `kbd:`, `btn:`, `menu:` (need `:experimental:`), `stem:`, index terms | `#adoc-kbd`, `#adoc-btn`, `#adoc-menu`, `#adoc-math`, `#adoc-indexterm`                                  |
| roles `[.role]#x#`                                                    | `#adoc-role(("role",))[x]` (`underline`/`line-through` map to Typst natively)                            |
| `toc::[]`, `<<<`, `'''`                                               | `#outline()`, `#pagebreak()`, `#line(length: 100%)`                                                      |
| `[typst]` + `++++`                                                    | emitted verbatim (raw Typst)                                                                             |

Every attribute the document or caller set is passed as
`attributes: ("toc": "", "sectnums": "", …)`, so the template can react to `:toc:`,
`:sectnums:`, `:lang:`, custom attributes, etc. Asciidoctor's built-ins are filtered out.

`backend-typst` and **`backend-pdf`** are defined, so `ifdef::backend-pdf[]` blocks written for
asciidoctor-pdf apply.

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

#bibliography(full: true, bytes(
  "dcm-dev:\n" + "  type: misc\n" + "  url: \"https://dcm.dev/\"\n" + …
))
```

- The Hayagriva YAML is **embedded as `bytes(...)`**, so the output stays a single, self-contained
  file with no path to resolve. The YAML is also returned as `ConvertResult.bibliographies`
  if you would rather write it to a file.
- Attribute references (`{zig-version}`) are already substituted by Asciidoctor.
- Fields are inferred from the entry text: `Author. (2009). _Title_. Rest.` gives `author`,
  `date`, `title` and `note`; `Title — https://…` gives `title` and `url`; a bare URL gives only
  `url`; anything else keeps its whole text as `title`. Nested list items are appended to `note`.
  Entries without an anchor are still listed (key `ref-N`).
- Citations of exported entries become `@key` (or `#cite(<key>)` where the key would run into
  following text).
- **Lost by design** (reported as a comment above `#bibliography`): list captions (Hayagriva has
  no grouping), custom reference labels (`[[[id,label]]]`) and custom citation text
  (`<<id,text>>`).
- **The section heading is replaced by Typst's generated bibliography title**, which follows the
  document language (`:lang:` becomes `set text(lang:)` in the template), e.g. _Bibliografía_. It is
  emitted at the section's level (`#set heading(offset: …)`), and the section's id is attached to
  the `#bibliography` call so `<<_references>>` links still work. The AsciiDoc title text is
  reported in the comment above the call. Style (numeric, author-date, …) is chosen in the template
  via `#bibliography(style:)`.

## Known limits

- `video::`/`audio::` become links; remote images (URLs) become links (Typst cannot fetch).
- Inline passthroughs (`+++…+++`, `pass:[]`) arrive as plain text (Asciidoctor restores them
  before converters see them), so they are escaped rather than emitted as raw Typst. Use a
  `[typst]` `++++` block for raw Typst. HTML block passthroughs are dropped with a warning.
- Math (`stem`) is passed to `adoc-math` as a string; plug a LaTeX/AsciiMath converter (e.g.
  the `mitex` package) in there.
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

- `tests/fixtures/` – the AsciiDoc inputs: small ones per feature area (`lists.adoc`, `tables.adoc`,
  `bibliography.adoc`, …), a multi-file one (`includes/main.adoc`) and two real-world documents
  (`docent.adoc`, `upsa-regulations.adoc`).
- `tests/snapshots/` – the expected Typst for every fixture (`<fixture>.typ`), plus
  `<fixture>.diagnostics.txt` where it is expected to warn. Each snapshot is also compiled with
  `typst` to prove it is valid.
- `tests/snapshots.test.ts` – compares every fixture with its snapshot and compiles it.
- `tests/convert.test.ts` – behavioural assertions, also driven by the fixtures, so a failure points
  at one behaviour instead of a whole-file diff.
- `tests/escape.test.ts` – pure unit tests of the escaping helpers.
- `tests/fixtures.ts` – fixture discovery and conversion shared by the test files.

To add a case: drop an `.adoc` in `tests/fixtures/`, run `UPDATE_SNAPSHOTS=1 bun test`, review the new
snapshot, and add assertions to `convert.test.ts` if it exercises new behaviour.
