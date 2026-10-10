/// https://docs.asciidoctor.org/asciidoc/latest/document/revision-information/
///
/// The converter passes the revision information as a dictionary with the keys that are set:
///
/// - `number`: the revision number or version (`revnumber`)
/// - `date`: the date of the revision (`revdate`)
/// - `remark`: a remark about the revision (`revremark`)
/// - `label`: the text printed before the number (the `version-label` attribute, "Version" by default)

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
