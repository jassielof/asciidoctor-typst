/// Heading numbering for a book with parts.
///
/// With parts the heading levels are: 1 = part, 2 = chapter, 3+ = sections. Typst's heading counter resets a level whenever the level above it steps, so the chapters would restart at 1 in every part (part 2, chapter 1 would be "2.1"). In a book the chapters are continuous across parts.
///
/// The thesis template (`typst-templates/upsa-bo`) keeps a separate chapter counter, stepped per chapter, which its numbering function reads. That works for the heading itself, but a counter stepped in a show rule sits *after* the heading's location, so reading it where the heading is referenced (outline, cross references) is off by one. Here the running chapter count stays in the heading counter itself instead: after a part has reset the chapter level, `carry-chapters` puts the count back. The numbering function then depends only on its own arguments, and the body, the outline and references all agree.

/// How many numbered chapters have been seen so far, across parts.
#let chapters-counter = counter("adoc-chapters")

/// The heading level of the chapters: 2 when the book has parts, 1 otherwise. Set by `adoc-book`.
#let chapter-level = state("adoc-chapter-level", 1)

/// Numbering function of the headings of a book with parts.
///
/// - part: roman numeral (`I`)
/// - chapter: the continuous chapter number (`3`)
/// - section and deeper: the chapter number and the position inside the chapter (`3.1`, `3.1.2`)
#let parts-numbering(..args) = {
  let pos = args.pos()
  if pos.len() == 1 {
    numbering("I", ..pos)
  } else if pos.len() == 2 {
    numbering("1", pos.last())
  } else {
    numbering("1.1.1", ..pos.slice(1))
  }
}

/// Counts the chapter heading `it`, if it is numbered and outlined (unnumbered chapters, such as a preface, do not take a number). Place it in the show rule of the chapters.
#let count-chapter(it) = if it.numbering != none and it.outlined { chapters-counter.step() }

/// Restores the chapter count after the part heading `it`. The part's own step has reset the chapter level to zero; this sets it back to the number of chapters so far, so the next chapter continues the numbering. Place it after the heading, in the show rule of the parts.
#let carry-chapters(it) = if it.numbering != none and it.outlined {
  context {
    let chapters = chapters-counter.get().first()
    // The update function receives the counter's values as arguments.
    counter(heading).update((..values) => (values.pos().first(), chapters))
  }
}

/// Restarts the chapter numbering at the first call, for the appendices: the first appendix is "A", not the chapter after the last one. Place it where an appendix starts.
#let restart-for-appendices = {
  let started = state("adoc-appendices-started", false)
  context {
    if not started.get() {
      started.update(true)
      let level = chapter-level.get()
      counter(heading).update((..values) => {
        let above = values.pos().slice(0, calc.min(level - 1, values.pos().len()))
        (..above, 0)
      })
    }
  }
}
