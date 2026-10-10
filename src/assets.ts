/**
 * The output of a conversion is a directory: `main.typ`, generated files (Hayagriva YAML) and the assets it refers to, so that `typst compile <dir>/main.typ` works without any other path.
 */
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, join, resolve } from "node:path";

export interface OutputFile {
  /** Path inside the output directory, with `/` separators. */
  path: string;
  /** Text content, for generated files. */
  content?: string;
  /** Absolute path of a file to copy verbatim, for assets. */
  source?: string;
}

const REMOTE = /^[a-z][a-z0-9+.-]*:\/\//i;

export class AssetBundle {
  private bySource = new Map<string, string>();
  private taken = new Set<string>();

  /**
   * @param baseDir directory that relative image URIs are resolved against (the source's).
   * @param warn receives a message for assets that cannot be bundled.
   */
  constructor(
    private baseDir: string,
    private warn: (message: string) => void,
  ) {}

  /**
   * Registers an image and returns its path inside the bundle (`images/<name>`). Returns `null` for remote or inline (`data:`) images, which Typst cannot load. A missing file is reported and its URI returned unchanged.
   */
  image(uri: string): string | null {
    if (REMOTE.test(uri) || uri.startsWith("data:")) return null;
    const source = isAbsolute(uri) ? uri : resolve(this.baseDir, uri);
    const known = this.bySource.get(source);
    if (known) return known;
    if (!existsSync(source)) {
      this.warn(`image file not found: ${uri}`);
      return uri;
    }
    const ext = extname(source);
    const stem = basename(source, ext);
    let dest = `images/${stem}${ext}`;
    for (let n = 2; this.taken.has(dest); n++) dest = `images/${stem}-${n}${ext}`;
    this.taken.add(dest);
    this.bySource.set(source, dest);
    return dest;
  }

  /** The assets to copy into the output directory. */
  get files(): OutputFile[] {
    return [...this.bySource].map(([source, path]) => ({ path, source }));
  }
}

/** Writes an output bundle to `dir`, creating subdirectories as needed. */
export function writeFiles(dir: string, files: OutputFile[]): void {
  for (const f of files) {
    const target = join(dir, ...f.path.split("/"));
    mkdirSync(dirname(target), { recursive: true });
    if (f.content !== undefined) writeFileSync(target, f.content);
    else if (f.source !== undefined) copyFileSync(f.source, target);
  }
}
