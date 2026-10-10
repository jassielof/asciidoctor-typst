/**
 * AsciiDoc bibliography -> Hayagriva (the bibliography format Typst reads).
 *
 * AsciiDoc leaves the structure of an entry free-form (only the `[[[id,reftext]]]` anchor is
 * defined), so fields are inferred on a best-effort basis from the common shapes:
 *
 *   Author. (2009). _Title_. Rest.      -> author, date, title, note
 *   Title text — https://example.org    -> title, url
 *   https://example.org/                -> url
 *   anything else                       -> the whole text becomes the title
 *
 * Nothing is invented: whatever cannot be placed in a field is kept in `note`/`title`, and what
 * Hayagriva cannot represent (list captions, custom reference labels) is reported to the caller.
 */
import type { AdocNode } from "./ast.ts";
import { labelName } from "./escape.ts";
import { entrySegments, type Segment } from "./inline.ts";

export interface BibEntry {
  /** Citation key (`@key` in Typst). */
  key: string;
  author?: string;
  date?: string;
  title?: string;
  note?: string;
  url?: string;
}

export interface BibSection {
  entries: BibEntry[];
  /** The list blocks of the section that were converted (and so must not be emitted again). */
  lists: Set<AdocNode>;
  /** Human-readable account of information Hayagriva cannot hold. */
  dropped: string[];
}

const clean = (s: string) => s.replace(/\s+/g, " ").trim();
const trimEnd = (s: string) => s.replace(/[\s.,;:—–-]+$/u, "");
const join = (segs: Segment[]) => clean(segs.map((s) => s.text).join(""));

/** Infers entry fields from the segments of one entry's text. */
export function parseEntry(segments: Segment[]): Omit<BibEntry, "key"> {
  const url = segments.find((s) => s.href)?.href;
  // Segments that only carry the URL are not part of the descriptive text.
  const body = segments.filter((s) => !(s.href && /^[a-z][\w+.-]*:\/\//i.test(s.text)));

  const first = body.findIndex((s) => s.emphasis);
  if (first < 0) {
    const title = trimEnd(join(body));
    return { title: title || undefined, url };
  }

  let last = first;
  while (last + 1 < body.length && body[last + 1]!.emphasis) last++;
  const title = trimEnd(join(body.slice(first, last + 1)));
  const prefix = join(body.slice(0, first));
  const suffix = clean(join(body.slice(last + 1)).replace(/^[\s.,;:]+/, "")).replace(/[\s.]+$/, "");

  const out: Omit<BibEntry, "key"> = { title: title || undefined, url };
  const notes: string[] = [];

  const m = /^(.*?)[.,]?\s*\(([^()]*)\)[.,]?$/.exec(prefix);
  if (m) {
    const author = trimEnd(m[1]!);
    if (author) out.author = author;
    const when = m[2]!.trim();
    if (/^\d{4}[a-z]?$/.test(when)) out.date = when.slice(0, 4);
    else if (when) notes.push(`(${when})`);
  } else if (prefix) {
    const author = trimEnd(prefix);
    if (author) out.author = author;
  }
  if (suffix) notes.push(suffix);
  if (notes.length) out.note = notes.join(" ");
  return out;
}

/** Plain text of an item and of its nested items, for the `note` field. */
function nestedNotes(item: AdocNode): string[] {
  const notes: string[] = [];
  for (const child of item.blocks) {
    if (child.context !== "ulist" && child.context !== "olist") continue;
    for (const sub of child.items) {
      const text = join(entrySegments(sub.text ?? "").segments);
      if (text) notes.push(text);
      notes.push(...nestedNotes(sub));
    }
  }
  return notes;
}

/** Converts the list blocks of a `[bibliography]` section into entries. */
export function buildBibSection(section: AdocNode): BibSection | null {
  const lists = section.blocks.filter((b) => b.context === "ulist" || b.context === "olist");
  if (lists.length === 0) return null;

  const entries: BibEntry[] = [];
  const dropped: string[] = [];
  const used = new Set<string>();
  const unique = (key: string) => {
    let k = key;
    for (let n = 2; used.has(k); n++) k = `${key}-${n}`;
    used.add(k);
    return k;
  };

  const captions = lists.map((l) => (l.hasTitle() ? l.title : null)).filter((t): t is string => !!t);
  if (captions.length) {
    dropped.push(`list captions are not representable in Hayagriva: ${captions.map(clean).join("; ")}`);
  }
  const relabeled: string[] = [];

  for (const list of lists) {
    for (const item of list.items) {
      const { anchor, segments } = entrySegments(item.text ?? "");
      const fields = parseEntry(segments);
      const notes = nestedNotes(item);
      if (notes.length) fields.note = [fields.note, ...notes].filter(Boolean).join("; ");
      const key = unique(anchor ? labelName(anchor.id) : `ref-${entries.length + 1}`);
      if (anchor?.reftext && anchor.reftext !== anchor.id) relabeled.push(`${anchor.id} (${anchor.reftext})`);
      if (!fields.title && !fields.url && !fields.author) fields.title = join(segments) || key;
      entries.push({ key, ...fields });
    }
  }
  if (relabeled.length) {
    dropped.push(`custom reference labels are not representable in Hayagriva: ${relabeled.join(", ")}`);
  }
  return { entries, lists: new Set(lists), dropped };
}

const q = (s: string) => JSON.stringify(s);
/** Plain YAML keys are fine unless YAML would read them as another type. */
const key = (s: string) =>
  /^[A-Za-z_][A-Za-z0-9_.:-]*$/.test(s) && !/^(?:y|n|yes|no|true|false|on|off|null|~)$/i.test(s) ? s : q(s);

/** Serialises entries as a Hayagriva YAML document. */
export function toHayagriva(entries: BibEntry[]): string {
  const lines: string[] = [];
  for (const e of entries) {
    lines.push(`${key(e.key)}:`);
    lines.push("  type: misc");
    if (e.author) lines.push("  author:", `    name: ${q(e.author)}`);
    if (e.date) lines.push(`  date: ${/^\d{4}$/.test(e.date) ? e.date : q(e.date)}`);
    if (e.title) lines.push(`  title: ${q(e.title)}`);
    if (e.note) lines.push(`  note: ${q(e.note)}`);
    if (e.url) lines.push(`  url: ${q(e.url)}`);
  }
  return lines.join("\n") + "\n";
}
