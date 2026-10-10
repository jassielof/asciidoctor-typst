/// https://docs.asciidoctor.org/asciidoc/latest/sections/abstract/
#let abstract-section(body, title: none) = {
  // show heading: set text(style: "normal")
  heading(title)

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

/// https://docs.asciidoctor.org/asciidoc/latest/sections/colophon/
#let colophon(body, title: none) = {
  heading(none)

  body
}
