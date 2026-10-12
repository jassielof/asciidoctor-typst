#import "document-info.typ": doctype-state
#import "numbering.typ" as numbering-lib

// Special sections, https://docs.asciidoctor.org/asciidoc/latest/sections/styles/
//
// - in articles and books: abstract, appendix, glossary, bibliography, index
// - books only: dedication, acknowledgments, preface, colophon, partintro
//
// The functions that draw their own heading (`abstract`, `dedication`, `acknowledgments`, `preface`, `colophon`) take `title` and `level`; the others wrap a heading written in the document.

/// https://docs.asciidoctor.org/asciidoc/latest/sections/abstract/
#let abstract-section(body, title: none) = {
  set heading(numbering: none)
  if title != none { heading(title) }

  body
}

/// https://docs.asciidoctor.org/asciidoc/latest/sections/abstract-block/
#let abstract-block(body, title: none) = {
  set quote(block: true, quotes: false)
  show quote: set text(style: "italic")
  show quote: set block(spacing: 1.5em)

  // This title has a similar styling as the lists title and others, they all use the "title" class.
  if title != none {
    set align(center)
    set text(fill: rgb(122, 37, 24))
    set block(spacing: 1.5em)
    block(title)
  }

  quote(body)
}

#let abstract(
  body,
  title: none,
  style: "section",
) = {
  assert(style in ("section", "block"), message: "Style must be either 'section' or 'block', found: '" + style + "'")

  show heading: set text(fill: rgb(186, 57, 37))
  set text(style: "italic")

  if style == "section" {
    abstract-section(body, title: title)
  } else {
    abstract-block(body, title: title)
  }
}

/// Fails when a section that only exists in books is used in another document type.
#let book-only(name, body) = context {
  assert(
    doctype-state.get() == "book",
    message: "`" + name + "` is a special section of books only; the document type is \"" + doctype-state.get() + "\"",
  )
  body
}

/// A special section that is not numbered and draws its own heading. `level` is the heading level of the section (2 in a book with parts).
#let special-section(body, title: none, level: 1) = {
  set heading(numbering: none)
  if title != none { heading(title, level: level) }

  body
}

/// https://docs.asciidoctor.org/asciidoc/latest/sections/colophon/
#let colophon(body, title: none, level: 1) = book-only("colophon", special-section(body, title: title, level: level))

/// https://docs.asciidoctor.org/asciidoc/latest/sections/dedication/
///
/// Centered and italic, with a heading that is not in the outline.
#let dedication(body, title: none, level: 1) = book-only("dedication", {
  set heading(numbering: none, outlined: false)
  align(center + horizon, emph({
    if title != none { heading(title, level: level) }
    body
  }))
})

/// https://docs.asciidoctor.org/asciidoc/latest/sections/acknowledgments/
#let acknowledgments(body, title: none, level: 1) = book-only(
  "acknowledgments",
  special-section(body, title: title, level: level),
)

/// https://docs.asciidoctor.org/asciidoc/latest/sections/preface/
#let preface(body, title: none, level: 1) = book-only("preface", special-section(body, title: title, level: level))

/// Sections written with their heading in the body: the heading is not numbered.
#let adoc-unnumbered(body) = {
  set heading(numbering: none)
  body
}

#let adoc-glossary(body) = adoc-unnumbered(body)
#let adoc-index(body) = adoc-unnumbered(body)
#let adoc-synopsis(body) = body

#let adoc-appendix(body) = {
  set heading(numbering: (..n) => "Appendix " + numbering("A", n.pos().last()))
  // The first appendix restarts the chapter numbering, so it is "Appendix A".
  numbering-lib.restart-for-appendices
  body
}

/// The introduction of a part (books only), written as an open block `[partintro]`.
#let adoc-partintro(body) = book-only("partintro", body)

/// Fallback for section styles without a dedicated function.
#let adoc-special(style, body) = body