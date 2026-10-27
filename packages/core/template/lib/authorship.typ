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

/// The names of `list`, joined with `delimiter`; a pure function, usable without `context`. `list` is normalised first, so names written with `_` print with spaces.
#let join-names(list, delimiter: ", ") = {
  normalize-authors(list).map(a => a.at("name", default: "")).filter(n => n != "").join(delimiter)
}
