#import "@preview/mitex:0.2.7": mi, mitex
#import "lib/paragraph.typ": leading-par, preamble
#import "lib/heading.typ": discrete-heading
#import "lib/sections.typ": (
  abstract, acknowledgments, adoc-appendix, adoc-glossary, adoc-index, adoc-partintro, adoc-special, adoc-synopsis,
  adoc-unnumbered, colophon, dedication, preface,
)
#import "lib/blocks.typ": *
#import "lib/authorship.typ" as authorship
#import "lib/authorship.typ": (
  author-count, author-email, author-field, author-firstname, author-initials, author-lastname, author-middlename,
  author-name, author-names, authors, join-names, normalize-authors, parse-author,
)
#import "lib/numbering.typ" as numbering-lib
#import "lib/style.typ" as style
#import "lib/title-page.typ" as title-page
#import "lib/version.typ" as version
#import "lib/version.typ": revision-field, revision-info, revision-remark, revision-summary
#import "lib/document-info.typ" as document-info
#import "lib/document-info.typ": document-doctype, document-lang

// asciidoctor-typst template library.
//
// A document is laid out in four steps, the same as a thesis template: the settings, then the front matter, the main matter and the back matter.
//
//   #show: settings.with(doctype: "book", title: [...], ...)
//   #show: front-matter   // title page, table of contents; abstract, dedication, preface, ...
//   #show: main-matter    // parts, chapters and sections
//   #show: back-matter    // appendices, glossary, bibliography, index, colophon
//
// The converter emits native Typst for everything Typst can express (headings, lists, term lists, tables, figures, links, footnotes, quotes, raw blocks) and calls the `adoc-*` functions for AsciiDoc concepts that have no Typst equivalent. Everything here is a plain default: restyle freely, the converter only relies on the signatures.
//
// An article is continuous and has two columns, like an IEEE paper; a book has a title page of its own and one column, and allows more special sections (`lib/sections.typ`).

// ------------------------------------------------------------------ settings

/// The document-wide settings: its type, its information and the styles of that type.
///
/// - `doctype`: `"book"` or `"article"` (`:doctype:`). Everything else that depends on the type (columns, title page, special sections) follows from it.
/// - `parts`: (books) when true, level 1 headings are parts, level 2 chapters, level 3 sections, ... Otherwise level 1 headings are chapters.
/// - `authors`: array of `(name:, email:)` dictionaries; the first, middle and last name and the initials are derived from `name` (see `lib/authorship.typ`).
/// - `revision`: dictionary with `number`, `date`, `remark` and `label` (see `lib/version.typ`).
/// - `logo`: `none`, or `(image:, align:)` for the title page image (`:title-logo-image:`); `image` is an `image(...)` built by the document.
/// - `lang`: the language of the document (`:lang:`).
/// - `fonts`: overrides of `(body:, title:, mono:)`; the defaults depend on the type (`lib/style.typ`).
/// - `attributes`: the other attributes set by the document header (strings), such as `toc` and `sectnums`. Those that have their own argument are not repeated here.
///
/// The authors, the revision, the language and the document type are also stored in states (`lib/authorship.typ`, `lib/version.typ`, `lib/document-info.typ`), which is what references in the document body read.
#let settings(
  doctype: "article",
  title: none,
  subtitle: none,
  authors: (),
  revision: (:),
  logo: none,
  lang: "en",
  parts: false,
  attributes: (:),
  fonts: (:),
  body,
) = {
  assert(
    doctype in ("book", "article"),
    message: "doctype must be \"book\" or \"article\", found: \"" + str(doctype) + "\"",
  )
  let authors = authorship.normalize-authors(authors)
  set document(
    title: if title != none { title } else { [] },
    author: authors.map(a => a.at("name", default: "")),
  )
  // Make the document information available to the whole template (`author-field`, `revision-field`, `document-lang`, ...), to the front matter and to the references in the body.
  authorship.set-authors(authors)
  version.set-revision(revision)
  document-info.set-document-info(lang: lang, doctype: doctype)
  document-info.set-settings(
    title: title,
    subtitle: subtitle,
    logo: logo,
    parts: parts and doctype == "book",
    attributes: attributes,
  )
  numbering-lib.chapter-level.update(if parts and doctype == "book" { 2 } else { 1 })

  let fonts = (:..style.default-fonts.at(doctype), ..fonts)
  if doctype == "book" {
    show: style.book.with(lang: lang, fonts: fonts, attributes: attributes, parts: parts)
    body
  } else {
    show: style.article.with(lang: lang, fonts: fonts, attributes: attributes)
    body
  }
}

// ------------------------------------------------------------------ matter

/// The front matter: the title page (a page of its own in a book, a block over both columns in an article) and the table of contents when `:toc:` is set. Abstract, dedication, preface and the other front sections follow it. In a book its pages are numbered with roman numerals.
#let front-matter(body) = context {
  let info = document-info.settings-state.get()
  let doctype = document-info.doctype-state.get()
  let revision = version.revision.get()
  let authors = authorship.authors.get()
  let toc = "toc" in info.attributes

  if doctype == "book" {
    title-page.book(title: info.title, subtitle: info.subtitle, authors: authors, revision: revision, logo: info.logo)
    // The title page has no number; the front matter pages are numbered from i.
    set page(numbering: "i")
    counter(page).update(1)
    if toc {
      outline()
      pagebreak()
    }
    body
  } else {
    title-page.article(title: info.title, subtitle: info.subtitle, authors: authors, revision: revision)
    if toc { outline() }
    body
  }
}

/// The main matter: the parts, chapters and sections. In a book the page numbers restart from 1 in arabic numerals.
#let main-matter(body) = context {
  if document-info.doctype-state.get() == "book" {
    set page(numbering: "1")
    counter(page).update(1)
    body
  } else {
    body
  }
}

/// The back matter: appendices, glossary, bibliography, index and colophon. Nothing here is numbered like a chapter (the appendix numbers itself, see `adoc-appendix`), and the bibliography's generated title is not numbered.
#let back-matter(body) = {
  set heading(numbering: none)
  show bibliography: set heading(numbering: none)
  body
}
