/// Language and type of the document.
///
/// - the language is the `lang` argument of the document wrapper (`:lang:` in the source); it is also what `text(lang:)` is set to, so hyphenation, smart quotes and generated titles such as the bibliography's follow it.
/// - the document type is `"book"` or `"article"`, decided by the wrapper that is used (`adoc-book` / `adoc-article`, from `:doctype:`).
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
