// AsciiDoc blocks and inline concepts that have no Typst equivalent. Plain, unstyled defaults: restyle freely, the converter only relies on the signatures.
#import "paragraph.typ": leading-par

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
#let adoc-mono(body) = text(font: "DejaVu Sans Mono", size: 0.8em, body)

/// Text with AsciiDoc roles, e.g. `[.lead]`. `roles` is an array of strings.
#let adoc-role(roles, id: none, body) = {
  let content = body
  for role in roles {
    if role == "lead" {
      content = leading-par(content)
    } else if role == "text-left" {
      content = align(left, content)
    } else if role == "text-center" {
      content = align(center, content)
    } else if role == "text-right" {
      content = align(right, content)
    } else if role == "underline" {
      content = underline(content)
    } else if role == "overline" {
      content = overline(content)
    } else if role == "line-through" {
      content = strike(content)
    } else if role == "nobreak" {
      content = text(hyphenate: false, content)
    } else if role == "nowrap" {
      content = box(content)
    }
  }
  content
}

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