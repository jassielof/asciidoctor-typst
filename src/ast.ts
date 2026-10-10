/**
 * The slice of the Asciidoctor node API this project uses.
 *
 * `@asciidoctor/core` ships typings, but they model nodes generically (many members are
 * `any`/untyped tuples, e.g. description lists and table rows). This interface states what the
 * emitter and inline converter actually rely on, so those files stay free of `any`.
 */

/** A description list entry: its terms and (optional) description. */
export type DListEntry = [terms: AdocNode[], description: AdocNode | null];

export interface AdocTableRows {
  head: AdocNode[][];
  body: AdocNode[][];
  foot: AdocNode[][];
}

export interface AdocNode {
  context: string;
  nodeName: string;
  style: string | null;
  id: string | null | undefined;
  level: number;
  sectname: string;
  special: boolean;
  contentModel: string;
  /** Converted title (section, block). */
  title: string | null;
  /** Converted text (list items, table head cells, inline nodes). */
  text: string | null;
  /** Inline node type qualifier (`xref`, `strong`, ...). */
  type: string | null;
  target: string | null;
  role: string | string[] | null;
  reftext: string | null;
  /** Child blocks; for description lists the entries are `DListEntry` tuples. */
  blocks: AdocNode[];
  items: AdocNode[];
  columns: AdocNode[];
  rows: AdocTableRows;
  colspan: number;
  rowspan: number;
  document: AdocDocument;
  attributes: Record<string, unknown>;

  /** Attribute values are dynamically typed in Asciidoctor (strings, arrays, booleans). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getAttribute(name: string, defaultValue?: unknown, fallbackName?: string | boolean | null): any;
  hasAttribute(name: string, expectedValue?: unknown): boolean;
  hasOption(name: string): boolean;
  hasRole(name: string): boolean;
  hasTitle(): boolean;
  /** Prefer `contentText` / `contentParts`, which narrow the result. */
  content(): Promise<string | string[]>;
  applySubs(text: string, subs?: string[]): Promise<string>;
  xreftext(xrefstyle?: string | null): Promise<string | null>;
  imageUri(target: string): Promise<string>;
  getAlt(): string;
  getLineNumber(): number | undefined;
  getFile(): string | undefined;
  getInnerDocument(): AdocDocument | null;
}

export interface AdocTitle {
  main?: string | null;
  subtitle?: string | null;
}

export interface AdocAuthor {
  getName(): string;
  getEmail(): string | undefined;
}

export interface AdocDocument extends AdocNode {
  catalog: { refs: Record<string, AdocNode | undefined> };
  getDoctype(): string;
  getDocumentTitle(opts?: { partition?: boolean }): AdocTitle | string | null;
  getAuthors(): AdocAuthor[];
  getRevisionNumber(): string | undefined;
  getRevisionDate(): string | undefined;
  getRevisionRemark(): string | undefined;
  getAttributes(): Record<string, unknown>;
}

/** Description list entries of a `dlist` node. */
export function dlistEntries(node: AdocNode): DListEntry[] {
  return node.blocks as unknown as DListEntry[];
}

export function asArray<T>(v: T[] | null | undefined): T[] {
  return Array.isArray(v) ? v : [];
}

/** Converted content of a block with a simple content model (a string). */
export async function contentText(node: AdocNode): Promise<string> {
  const c = await node.content();
  return Array.isArray(c) ? c.join("\n") : c;
}

/** Converted content of a table cell (one string per paragraph). */
export async function contentParts(node: AdocNode): Promise<string[]> {
  const c = await node.content();
  return Array.isArray(c) ? c : c === "" ? [] : [c];
}
