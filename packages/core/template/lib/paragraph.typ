// https://docs.asciidoctor.org/asciidoc/latest/blocks/preamble-and-lead/#preamble-style
// The preamble, unlike the leading, is automatic.
#let preamble(body) = {
  set text(size: 1.25em, weight: "medium")
  body
}

// https://docs.asciidoctor.org/asciidoc/latest/blocks/preamble-and-lead/#lead-role
// Supposedly it should be autoamtic to the very first paragraph of any section, but the HTML/DocBook only does it for those that are manually marked. So we'll follow the HTML behavior
#let leading-par(body) = {
  set text(size: 1.2em)
  body
}
