/// Language and type of the document.
///
/// - the language is the `lang` argument of `settings` (`:lang:` in the source); it is also what `text(lang:)` is set to, so hyphenation, smart quotes and generated titles such as the bibliography's follow it.
/// - the document type is `"book"` or `"article"`, the `doctype` argument of `settings` (from `:doctype:`).
///
/// References such as `{lang}` and `{doctype}` in the AsciiDoc source become `#document-lang()` and `#document-doctype()`, so changing the language on the Typst side updates them.

/// The language of the document, an ISO 639 code such as `"es"`.
#let lang-state = state("document-lang", "en")

/// The type of the document: `"book"` or `"article"`.
#let doctype-state = state("document-doctype", "article")

/// Stores the language and document type. Must be placed in the document (it returns content).
#let set-document-info(lang: "en", doctype: "article") = {
  lang-state.update(lang)
  doctype-state.update(doctype)
}

/// The language of the document, as content.
#let document-lang() = context lang-state.get()

/// The type of the document, as content.
#let document-doctype() = context doctype-state.get()

/// The rest of what the document header sets, kept for the front matter (the title page and the table of contents are drawn there, not by `settings`).
///
/// - `title`, `subtitle`: content
/// - `logo`: `none`, or `(image:, align:)`
/// - `parts`: whether the book has parts
/// - `attributes`: the other header attributes (`toc`, `sectnums`, ...)
#let settings-state = state("adoc-settings", (title: none, subtitle: none, logo: none, parts: false, attributes: (:)))

#let set-settings(title: none, subtitle: none, logo: none, parts: false, attributes: (:)) = settings-state.update((
  title: title,
  subtitle: subtitle,
  logo: logo,
  parts: parts,
  attributes: attributes,
))
