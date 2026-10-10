#import "lib/sections.typ": abstract

// adoc2typ template library.
//
// The converter emits native Typst for everything Typst can express (headings, lists, term
// lists, tables, figures, links, footnotes, quotes, raw blocks) and calls the `adoc-*`
// functions below for AsciiDoc concepts that have no Typst equivalent. Everything here is a
// plain, unstyled default: restyle freely, the converter only relies on the signatures.

// ------------------------------------------------------------------ document

/// Wrapper for `:doctype: book`.
///
/// - `parts`: when true, level 1 headings are parts, level 2 chapters, level 3 sections, ...
///   Otherwise level 1 headings are chapters.
/// - `attributes`: every attribute set by the document header (strings).
#let adoc-book(
  title: none,
  subtitle: none,
  authors: (),
  revision: (:),
  parts: false,
  attributes: (:),
  body,
) = {
  set document(
    title: if title != none { title } else { [] },
    author: authors.map(a => a.name),
  )
  set page(paper: "a4")
  set text(lang: attributes.at("lang", default: "en"))
  set par(justify: true)
  set heading(numbering: if "sectnums" in attributes { "1.1.1" } else { none })

  // Title page.
  {
    set align(horizon + right)

    if title != none { text(2.4em, weight: "bold", title) }
    if subtitle != none {
      v(0.4em)
      text(1.4em, subtitle)
    }
    v(2em)
    for a in authors [#a.name \ ]
    if "date" in revision { revision.date }
    pagebreak()
  }

  if "toc" in attributes {
    outline()
    pagebreak()
  }

  // Start every chapter (or part) on a new page.
  show heading.where(level: if parts { 2 } else { 1 }): it => {
    pagebreak(weak: true)
    it
  }
  if parts {
    show heading.where(level: 1): it => {
      pagebreak(weak: true)
      align(center + horizon, text(2em, it))
    }
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
  parts: false,
  attributes: (:),
  body,
) = {
  set document(
    title: if title != none { title } else { [] },
    author: authors.map(a => a.name),
  )
  set text(lang: attributes.at("lang", default: "en"))
  set par(justify: true)
  set heading(numbering: if "sectnums" in attributes { "1.1.1" } else { none })

  align(center)[
    #if title != none { text(1.8em, weight: "bold", title) }
    #if subtitle != none {
      v(0.2em)
      text(1.2em, subtitle)
    }
    #v(0.6em)
    #for a in authors [#a.name \ ]
    #if "date" in revision { revision.date }
  ]
  if "toc" in attributes { outline() }

  body
}

#let adoc-unnumbered(body) = {
  set heading(numbering: none)
  body
}



#let adoc-preface(body) = adoc-unnumbered(body)
#let adoc-foreword(body) = adoc-unnumbered(body)
#let adoc-afterword(body) = adoc-unnumbered(body)
#let adoc-dedication(body) = {
  set heading(numbering: none, outlined: false)
  align(center + horizon, emph(body))
}
#let adoc-acknowledgments(body) = adoc-unnumbered(body)
#let adoc-colophon(body) = adoc-unnumbered(body)
#let adoc-glossary(body) = adoc-unnumbered(body)
#let adoc-bibliography(body) = adoc-unnumbered(body)
#let adoc-index(body) = adoc-unnumbered(body)
#let adoc-synopsis(body) = body
#let adoc-appendix(body) = {
  set heading(numbering: (..n) => "Appendix " + numbering("A", n.pos().last()))
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

/// Math written in LaTeX or AsciiMath. Swap in a converter (e.g. the `mitex` package) here.
#let adoc-math(kind, source, block: false) = if block {
  align(center, raw(source, block: true, lang: if kind == "latexmath" { "latex" } else { none }))
} else {
  raw(source)
}

/// Index term. `terms` is `(primary, secondary, tertiary)`; visible terms are printed.
#let adoc-indexterm(terms, visible: false) = if visible { terms.first() }
