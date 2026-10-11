/// https://docs.asciidoctor.org/asciidoc/latest/document/revision-information/
///
/// The converter passes the revision information as a dictionary with the keys that are set:
///
/// - `number`: the revision number or version (`revnumber`)
/// - `date`: the date of the revision (`revdate`)
/// - `remark`: a remark about the revision (`revremark`)
/// - `label`: the text printed before the number (the `version-label` attribute, "Version" by default)

/// The revision of the document, as the dictionary described above. Filled by `adoc-book` / `adoc-article` through `set-revision`, so the template and the document can read it from anywhere. A reference such as `{revnumber}` in the AsciiDoc source becomes `#revision-field("number")`, so changing the revision on the Typst side updates it.
#let revision = state("revision", (:))

/// Stores the revision. Must be placed in the document (it returns content).
#let set-revision(value) = revision.update(value)

/// One key of the revision (`"number"`, `"date"`, `"remark"`, `"label"`), or `default`.
///
/// Needs a document context to read the state, so it returns content.
#let revision-field(field, default: none) = context revision.get().at(field, default: default)

/// "Version 1.0, 2026-10-12": the label and number, then the date. `none` when there is neither a number nor a date.
#let revision-summary(revision, default-label: "Version") = {
  let parts = ()
  if "number" in revision {
    let label = revision.at("label", default: default-label)
    parts.push(if label == "" { revision.number } else { label + " " + revision.number })
  }
  if "date" in revision { parts.push(revision.date) }
  if parts.len() == 0 { none } else { parts.join(", ") }
}

/// The remark of the revision, or `none`.
#let revision-remark(revision) = revision.at("remark", default: none)

/// The whole revision information as it appears on a title page: the summary, and the remark on the line below it. `none` when the document has no revision information.
#let revision-info(revision, default-label: "Version") = {
  let summary = revision-summary(revision, default-label: default-label)
  let remark = revision-remark(revision)
  if summary == none and remark == none { return none }
  if summary == none { return remark }
  if remark == none { return summary }
  [#summary: #remark]
}
