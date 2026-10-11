#import "@preview/mitex:0.2.7": mi, mitex
#import "lib/sections.typ": abstract, colophon
#import "lib/authorship.typ" as authorship
#import "lib/authorship.typ": (
  author-count, author-email, author-field, author-firstname, author-initials, author-lastname, author-middlename,
  author-name, author-names, authors, join-names, normalize-authors, parse-author,
)
#import "lib/numbering.typ" as numbering-lib
#import "lib/title-page.typ" as title-page
#import "lib/version.typ" as version
#import "lib/version.typ": revision-field, revision-info, revision-remark, revision-summary
#import "lib/document-info.typ" as document-info
#import "lib/document-info.typ": document-doctype, document-lang

// adoc2typ template library.
//
// The converter emits native Typst for everything Typst can express (headings, lists, term lists, tables, figures, links, footnotes, quotes, raw blocks) and calls the `adoc-*` functions below for AsciiDoc concepts that have no Typst equivalent. Everything here is a plain, unstyled default: restyle freely, the converter only relies on the signatures.

// ------------------------------------------------------------------ document

/// Wrapper for `:doctype: book`.
///
/// - `parts`: when true, level 1 headings are parts, level 2 chapters, level 3 sections, ... Otherwise level 1 headings are chapters.
/// - `authors`: array of `(name:, email:)` dictionaries; the first, middle and last name and the initials are derived from `name` (see `lib/authorship.typ`).
/// - `revision`: dictionary with `number`, `date`, `remark` and `label` (see `lib/version.typ`).
/// - `logo`: `none`, or `(image:, align:)` for the title page image (`:title-logo-image:`); `image` is an `image(...)` built by the document.
/// - `lang`: the language of the document (`:lang:`).
/// - `attributes`: the other attributes set by the document header (strings). Those that have their own argument (`revision`, `logo`, `lang`) or are the wrapper itself (`doctype`) are not repeated here.
///
/// The authors, the revision, the language and the document type are also stored in states (`lib/authorship.typ`, `lib/version.typ`, `lib/document-info.typ`), which is what references in the document body read.
#let adoc-book(
  title: none,
  subtitle: none,
  authors: (),
  revision: (:),
  logo: none,
  lang: "en",
  parts: false,
  attributes: (:),
  body,
) = {
  let authors = authorship.normalize-authors(authors)
  set document(
    title: if title != none { title } else { [] },
    author: authors.map(a => a.at("name", default: "")),
  )
  // Make the document information available to the whole template (`author-field`, `revision-field`, `document-lang`, ...) and to the references in the body.
  authorship.set-authors(authors)
  version.set-revision(revision)
  document-info.set-document-info(lang: lang, doctype: "book")
  numbering-lib.chapter-level.update(if parts { 2 } else { 1 })

  set page(paper: "a4")
  set text(lang: lang)
  set par(justify: true)
  // With parts the chapters are counted across parts (`lib/numbering.typ`), not per part.
  set heading(
    numbering: if "sectnums" not in attributes { none } else if parts { numbering-lib.parts-numbering } else {
      "1.1.1"
    },
  )

  title-page.book(title: title, subtitle: subtitle, authors: authors, revision: revision, logo: logo)

  if "toc" in attributes {
    outline()
    pagebreak()
  }

  // Start every chapter (or part) on a new page.
  show heading.where(level: if parts { 2 } else { 1 }): it => {
    pagebreak(weak: true)
    if parts { numbering-lib.count-chapter(it) }
    it
  }
  // A `show` rule only applies inside the scope it is written in, so the condition goes inside it.
  show heading.where(level: 1): it => if parts {
    pagebreak(weak: true)
    align(center + horizon, text(2em, it))
    numbering-lib.carry-chapters(it)
  } else {
    it
  }

  show heading: set text(
    fill: rgb(186, 57, 37),
    font: "Reforma 2018",
    style: "normal",
  )

  show heading.where(level: 1): set block(
    spacing: 1.5em,
    stroke: (
      top: (
        thickness: 1pt,
        paint: rgb("#e7e7e9"),
      ),
    ),
    inset: (
      top: 1.25em,
    ),
    width: 100%,
  )

  set text(font: "Reforma 1969")

  body
}

/// Wrapper for `:doctype: article` (the default).
#let adoc-article(
  title: none,
  subtitle: none,
  authors: (),
  revision: (:),
  logo: none,
  lang: "en",
  parts: false,
  attributes: (:),
  body,
) = {
  let authors = authorship.normalize-authors(authors)
  set document(
    title: if title != none { title } else { [] },
    author: authors.map(a => a.at("name", default: "")),
  )
  authorship.set-authors(authors)
  version.set-revision(revision)
  document-info.set-document-info(lang: lang, doctype: "article")
  set text(lang: lang)
  set par(justify: true)
  set heading(numbering: if "sectnums" in attributes { "1.1.1" } else { none })

  align(center)[
    #if title != none { text(1.8em, weight: "bold", title) }
    #if subtitle != none {
      v(0.2em)
      text(1.2em, subtitle)
    }
    #v(0.6em)
    #join-names(authors)
    #if revision-info(revision) != none {
      linebreak()
      revision-info(revision)
    }
  ]
  if "toc" in attributes { outline() }

  body
}

#let adoc-unnumbered(body) = {
  set heading(numbering: none)
  body
}



// Similar to the TODO in acknowledgments, remove these and add a sections.* for each of them, to be used in the template.
#let adoc-preface(body) = adoc-unnumbered(body)
#let adoc-foreword(body) = adoc-unnumbered(body)
#let adoc-afterword(body) = adoc-unnumbered(body)

// TODO: Use sections.dedication instead, this should be removed.
#let adoc-dedication(body) = {
  set heading(numbering: none, outlined: false)
  align(center + horizon, emph(body))
}

// TODO: Remove it and add a sections.acknowledgments instead to-be used.
#let adoc-acknowledgments(body) = adoc-unnumbered(body)

// TODO: Use sections.colophon instead, this should be removed.
#let adoc-colophon(body) = adoc-unnumbered(body)
#let adoc-glossary(body) = adoc-unnumbered(body)

// TODO: Use bibliography directly instead, this should be removed.
#let adoc-bibliography(body) = adoc-unnumbered(body)
#let adoc-index(body) = adoc-unnumbered(body)
#let adoc-synopsis(body) = body
#let adoc-appendix(body) = {
  set heading(numbering: (..n) => "Appendix " + numbering("A", n.pos().last()))
  // The first appendix restarts the chapter numbering, so it is "Appendix A".
  numbering-lib.restart-for-appendices
  body
}
#let adoc-partintro(body) = body

/// Fallback for section styles without a dedicated function.
#let adoc-special(style, body) = body

// ------------------------------------------------------------------ blocks

/// Title of a block that has no native caption (lists, paragraphs, quotes, ...).
#let adoc-block-title(body) = block(sticky: true, below: 0.5em, strong(body))

/// `kind` is one of "note", "tip", "important", "warning", "caution".
#let adoc-admonition(kind, title: none, body) = block(
  width: 100%,
  inset: (left: 0.8em, y: 0.5em),
  stroke: (left: 2pt + luma(120)),
  {
    strong(if title != none { title } else { upper(kind.first()) + kind.slice(1) })
    parbreak()
    body
  },
)

#let adoc-sidebar(title: none, body) = block(
  width: 100%,
  inset: 0.8em,
  fill: luma(245),
  radius: 3pt,
  {
    if title != none {
      strong(title)
      parbreak()
    }
    body
  },
)

#let adoc-example(title: none, body) = block(
  width: 100%,
  inset: 0.8em,
  stroke: 0.5pt + luma(180),
  {
    if title != none {
      strong(title)
      parbreak()
    }
    body
  },
)

#let adoc-verse(attribution: none, body) = block(inset: (left: 1.5em), {
  body
  if attribution != none {
    parbreak()
    align(right, [--- #attribution])
  }
})

/// Source code with callout markers.
///
/// `callouts` is an array of `(line, number)` pairs; `line` is zero-based.
#let adoc-callout-code(text, lang: none, callouts: ()) = {
  let lines = text.split("\n")
  let marked = lines
    .enumerate()
    .map(((i, l)) => {
      let marks = callouts.filter(c => c.at(0) == i).map(c => "(" + str(c.at(1)) + ")")
      if marks.len() == 0 { l } else { l + "  " + marks.join(" ") }
    })
  raw(marked.join("\n"), block: true, lang: lang)
}

/// The list that explains callouts; `items` is an array of content.
#let adoc-callout-list(items) = enum(numbering: "(1)", ..items)

// ------------------------------------------------------------------ inline

/// Monospace text that needs nested formatting (plain monospace uses `raw`).
#let adoc-mono(body) = text(font: ("DejaVu Sans Mono", "Consolas", "Liberation Mono"), body)

/// Text with AsciiDoc roles, e.g. `[.lead]`. `roles` is an array of strings.
#let adoc-role(roles, id: none, body) = body

#let adoc-kbd(..keys) = {
  let boxes = keys
    .pos()
    .map(k => box(
      stroke: 0.5pt + luma(150),
      inset: (x: 3pt, y: 1.5pt),
      outset: (y: 1.5pt),
      radius: 2pt,
      k,
    ))
  boxes.join("+")
}

#let adoc-btn(label) = box(stroke: 0.5pt, inset: (x: 3pt, y: 1.5pt), outset: (y: 1.5pt), radius: 2pt, label)

#let adoc-menu(..items) = items.pos().map(strong).join([ #sym.arrow.r.filled ])

#let adoc-icon(name) = [\[#name\]]

/// Index term. `terms` is `(primary, secondary, tertiary)`; visible terms are printed.
#let adoc-indexterm(terms, visible: false) = if visible { terms.first() }

/// References:
/// - https://github.com/asciidoctor/asciidoctor-pdf/blob/main/data/themes/default-theme.yml
