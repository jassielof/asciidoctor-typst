/// https://docs.asciidoctor.org/asciidoc/latest/document/author-information/
///
/// An author is given as a dictionary with only what the author line carries:
///
/// - `name`: the full name, as written on the author line. Words are separated by spaces and a `_` joins the words of one name (`Jassiel Ovando_F.`: the last name is "Ovando F.").
/// - `email`: optional.
///
/// Everything else is derived from the name, by the same rules AsciiDoc uses (`parse-author`):
///
/// - `firstname`: the first name
/// - `middlename`: the second name, when there are three
/// - `lastname`: the last name (the third, or the second when there are only two)
/// - `initials`: the first character of each of those, up to three
///
/// A name of more than three words is kept whole as the first name, as in AsciiDoc. Keys given explicitly in the dictionary win over the derived ones, so a name can be corrected by hand.
///
/// The derived authors are stored in a `state`, so the template and the document can read them from anywhere (`author-field`, `author-firstname`, ...). A reference such as `{lastname_2}` in the AsciiDoc source becomes `#author-field(n: 2, field: "lastname")`, so changing an author on the Typst side updates every reference.

/// The parts of a name as AsciiDoc derives them: an array of at most three names, or a single whole name when it has more than three words.
#let name-parts(name) = {
  let words = name.split(regex("\\s+")).filter(w => w != "").map(w => w.replace("_", " "))
  if words.len() > 3 { (words.join(" "),) } else { words }
}

/// Completes an author dictionary: derives `firstname`, `middlename`, `lastname` and `initials` from `name`, and normalises `name` for display (`_` becomes a space). Keys already present are kept.
#let parse-author(author) = {
  let written = author.at("name", default: "")
  let parts = name-parts(written)

  let derived = (:)
  if parts.len() >= 1 { derived.firstname = parts.first() }
  if parts.len() == 3 { derived.middlename = parts.at(1) }
  if parts.len() >= 2 { derived.lastname = parts.last() }
  if parts.len() >= 1 { derived.initials = parts.map(p => p.clusters().first()).join() }

  let result = derived + author
  result.name = parts.join(" ")
  result
}

/// Completes every author of `list` (see `parse-author`). A pure function.
#let normalize-authors(list) = list.map(parse-author)

/// All authors of the document, in order, complete with their derived parts. Filled by `adoc-book` / `adoc-article` through `set-authors`.
#let authors = state("authors", ())

/// Stores the authors (derived parts included). Must be placed in the document (it returns content).
#let set-authors(list) = authors.update(normalize-authors(list))

/// The names of `list`, joined with `delimiter`; a pure function, usable without `context`. `list` is normalised first, so names written with `_` print with spaces.
#let join-names(list, delimiter: ", ") = {
  normalize-authors(list).map(a => a.at("name", default: "")).filter(n => n != "").join(delimiter)
}

/// A field of the `n`-th author, 1-based like `{lastname_2}` in AsciiDoc. `field` is one of `"name"`, `"firstname"`, `"middlename"`, `"lastname"`, `"initials"`, `"email"`.
///
/// Needs a document context to read the state, so it returns content (or `default`).
#let author-field(n: 1, field: "name", default: none) = context {
  let list = authors.get()
  if n >= 1 and n <= list.len() { list.at(n - 1).at(field, default: default) } else { default }
}

/// The full name of the `n`-th author.
#let author-name(n: 1, default: none) = author-field(n: n, field: "name", default: default)

/// The first name of the `n`-th author.
#let author-firstname(n: 1, default: none) = author-field(n: n, field: "firstname", default: default)

/// The middle name of the `n`-th author.
#let author-middlename(n: 1, default: none) = author-field(n: n, field: "middlename", default: default)

/// The last name of the `n`-th author.
#let author-lastname(n: 1, default: none) = author-field(n: n, field: "lastname", default: default)

/// The initials of the `n`-th author.
#let author-initials(n: 1, default: none) = author-field(n: n, field: "initials", default: default)

/// The email of the `n`-th author.
#let author-email(n: 1, default: none) = author-field(n: n, field: "email", default: default)

/// The names of all authors, joined with `delimiter`.
#let author-names(delimiter: ", ") = context join-names(authors.get(), delimiter: delimiter)

/// How many authors the document has (`authorcount`).
#let author-count() = context authors.get().len()
