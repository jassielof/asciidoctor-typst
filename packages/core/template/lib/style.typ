#import "numbering.typ" as numbering-lib

// The styles of a document. Articles and books share `base`; each adds its own headings and layout on top of it.

/// Fonts by document type; `settings(fonts:)` overrides single entries.
#let default-fonts = (
  article: (body: "Libertinus Serif", title: "Libertinus Serif", mono: "DejaVu Sans Mono"),
  book: (body: "Reforma 1969", title: "Reforma 2018", mono: "DejaVu Sans Mono"),
)

/// What articles and books share: page, text, paragraphs, heading numbering and code.
///
/// - `columns`: 2 for an article, 1 for a book.
/// - `paper`: `"us-letter"` for an article, `"a4"` for a book.
#let base(
  body,
  lang: "en",
  fonts: default-fonts.article,
  attributes: (:),
  columns: 2,
  paper: "us-letter",
  size: 10pt,
) = {
  set page(paper: paper, columns: columns, margin: if columns == 2 { (x: 0.7in, y: 0.9in) } else { auto })
  set text(lang: lang, font: fonts.body, size: size)
  set par(justify: true, leading: 0.6em, spacing: 0.9em)
  set heading(numbering: if "sectnums" in attributes { "1.1.1" } else { none })
  show heading: set text(font: fonts.title)
  show raw: set text(font: fonts.mono)
  body
}

/// Style of an article: continuous, two columns, like an IEEE paper. The title block floats over both columns at the top of the first page (`title-page.article`).
#let article(
  body,
  lang: "en",
  fonts: default-fonts.article,
  attributes: (:),
) = {
  show: base.with(lang: lang, fonts: fonts, attributes: attributes, columns: 2, paper: "us-letter", size: 10pt)

  show heading.where(level: 1): it => {
    set align(center)
    set par(hanging-indent: 0pt)
    set text(size: 1.05em, weight: "regular")
    smallcaps(it)
  }
  show heading.where(level: 2): set text(size: 1em, style: "italic", weight: "regular")

  body
}
/// Style of a book, built on the same base as the article: one column, a title page of its own, chapters (or parts) starting on a new page.
///
/// - `parts`: when true, level 1 headings are parts, level 2 chapters, and the chapters are counted across parts (`lib/numbering.typ`).
#let book(
  body,
  lang: "en",
  fonts: default-fonts.book,
  attributes: (:),
  parts: false,
) = {
  show: base.with(lang: lang, fonts: fonts, attributes: attributes, columns: 1, paper: "a4", size: 11pt)

  // With parts the chapters are counted across parts, not per part.
  set heading(
    numbering: if "sectnums" not in attributes { none } else if parts { numbering-lib.parts-numbering } else {
      "1.1.1"
    },
  )

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
    font: fonts.title,
    style: "normal",
    weight: "bold",
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

  body
}