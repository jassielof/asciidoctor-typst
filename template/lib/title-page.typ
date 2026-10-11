#import "authorship.typ": join-names
#import "version.typ": revision-info

/// Title page of a book, laid out like Asciidoctor PDF's default theme (`title_page`): text aligned right, the logo near the top (10% down), the title block 55% down.
///
/// Sizes follow the theme's formulas relative to the body text size (`em`), so they scale with whatever the template sets:
///
/// - title: `heading_h1_font_size` (2.6x), grey `999999`, line height 0.9
/// - subtitle: `heading_h3_font_size` (1.7x), bold italic, line height 1; directly under the title; no colour of its own, so the base text colour (`333333`)
/// - authors: `base_font_size_large` (1.25x), `181818`, 1.25x above
/// - revision: body size, 1.25x above; the base text colour (`333333`)
///
/// The blocks have no spacing of their own (Typst's default paragraph spacing would double the theme's gaps): the only vertical space is what the theme asks for.
///
/// - `logo`: `none`, or a dictionary with `image` (an `image(...)` already built by the document, so its path is relative to the document) and optionally `align` (the `title-logo-image` attribute).
/// - `authors`: array of author dictionaries (see `authorship.typ`).
/// - `revision`: dictionary of revision information (see `version.typ`).
///
/// The page is closed with a page break. `base.font_color` of the default theme. Elements the theme gives no colour inherit it; it is set here so the title page does not depend on the colour the rest of the template uses.
#let base-color = rgb("333333")

#let book(
  title: none,
  subtitle: none,
  authors: (),
  revision: (:),
  logo: none,
) = {
  set align(right)

  if logo != none {
    place(
      top + logo.at("align", default: right),
      dy: 10%,
      logo.image,
    )
  }

  // Each element is a block with its own text size, so its line box matches its size; blocks have no spacing of their own, the only gaps are the ones the theme specifies.
  place(top + right, dy: 55%, block(width: 100%, {
    set block(spacing: 0pt)
    set par(justify: false)
    // Typst's default text edges (cap height to baseline) make a block only as tall as its capitals, so blocks without spacing would touch. The font's own ascender and descender give the natural line box, which is what the theme's line heights refer to.
    set text(top-edge: "ascender", bottom-edge: "descender")

    if title != none {
      block({
        set text(size: 2.6em, fill: rgb("999999"))
        set par(leading: 0.3em)
        title
      })
    }

    if subtitle != none {
      block({
        set text(size: 1.7em, weight: "bold", style: "italic", fill: base-color)
        set par(leading: 0.4em)
        subtitle
      })
    }

    let names = join-names(authors)
    if names != "" {
      block(above: 1.25em, {
        set text(size: 1.25em, fill: rgb("181818"))
        names
      })
    }

    let info = revision-info(revision)
    if info != none {
      block(above: 1.25em, {
        set par(leading: 0.55em)
        set text(fill: base-color)
        info
      })
    }
  }))

  pagebreak()
}