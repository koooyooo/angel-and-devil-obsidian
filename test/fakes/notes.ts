import type { DailyNoteRules, NoteRef, NoteStore } from "../../src/ports";

/** A note in FakeNoteStore. Like a TFile, the same object follows renames. */
export class FakeNote implements NoteRef {
  constructor(public path: string) {}
  get basename(): string {
    return (this.path.split("/").pop() ?? "").replace(/\.md$/i, "");
  }
}

function withoutMd(path: string): string {
  return path.replace(/\.md$/i, "");
}

/**
 * In-memory NoteStore. Links follow Obsidian's default style: the bare name when it is unique in the vault,
 * the path (without .md) otherwise. A rename does not rewrite links in other notes.
 */
export class FakeNoteStore implements NoteStore {
  private readonly files = new Map<FakeNote, string>();
  private readonly folders = new Set<string>();
  private readonly frontmatters = new Map<FakeNote, Record<string, unknown>>();
  /** Every write, in order (for tests that check nothing else was touched). */
  readonly writes: string[] = [];

  constructor(initial: Record<string, string> = {}) {
    for (const [path, content] of Object.entries(initial)) this.add(path, content);
  }

  /** Test setup: adds a file (and its parent folders) without counting it as a write. */
  add(path: string, content = "", frontmatter?: Record<string, unknown>): FakeNote {
    const note = new FakeNote(path);
    this.files.set(note, content);
    this.addParents(path);
    if (frontmatter) this.frontmatters.set(note, frontmatter);
    return note;
  }

  /** Test helper: the content at `path`, or undefined. */
  content(path: string): string | undefined {
    const note = this.find(path);
    return note ? this.files.get(note) : undefined;
  }

  paths(): string[] {
    return [...this.files.keys()].map((n) => n.path).sort();
  }

  /** Simulates the user deleting a note. */
  delete(note: NoteRef): void {
    this.files.delete(note as FakeNote);
  }

  get(path: string): NoteRef | null {
    return this.find(path) ?? null;
  }

  exists(note: NoteRef): boolean {
    return this.files.has(note as FakeNote);
  }

  isTaken(path: string): boolean {
    return this.find(path) !== undefined || this.folders.has(path);
  }

  async read(note: NoteRef): Promise<string> {
    return this.mustGet(note);
  }

  async process(note: NoteRef, update: (data: string) => string): Promise<void> {
    this.files.set(note as FakeNote, update(this.mustGet(note)));
    this.writes.push(note.path);
  }

  async create(path: string, data: string): Promise<NoteRef> {
    if (this.isTaken(path)) throw new Error(`Already exists: ${path}`);
    const parent = path.split("/").slice(0, -1).join("/");
    if (parent && !this.folders.has(parent)) throw new Error(`No folder: ${parent}`);
    const note = new FakeNote(path);
    this.files.set(note, data);
    this.writes.push(path);
    return note;
  }

  async ensureFolder(folder: string): Promise<void> {
    let path = "";
    for (const segment of folder.split("/")) {
      path = path ? `${path}/${segment}` : segment;
      if (this.find(path)) throw new Error(`Not a folder: ${path}`);
      this.folders.add(path);
    }
  }

  /** Also simulates the user renaming a note. */
  async rename(note: NoteRef, newPath: string): Promise<void> {
    if (this.isTaken(newPath)) throw new Error(`Already exists: ${newPath}`);
    this.mustGet(note);
    (note as FakeNote).path = newPath;
    this.addParents(newPath);
    this.writes.push(newPath);
  }

  frontmatter(note: NoteRef): Record<string, unknown> | undefined {
    return this.frontmatters.get(note as FakeNote);
  }

  linkText(note: NoteRef, _fromPath: string): string {
    const sameName = [...this.files.keys()].filter((n) => n.basename === note.basename);
    return sameName.length === 1 ? note.basename : withoutMd(note.path);
  }

  resolveLink(target: string, _fromPath: string): NoteRef | null {
    const t = withoutMd(target.split("#")[0].trim());
    const notes = [...this.files.keys()];
    return notes.find((n) => withoutMd(n.path) === t) ?? notes.find((n) => n.basename === t) ?? null;
  }

  private find(path: string): FakeNote | undefined {
    for (const note of this.files.keys()) if (note.path === path) return note;
    return undefined;
  }

  private mustGet(note: NoteRef): string {
    const content = this.files.get(note as FakeNote);
    if (content === undefined) throw new Error(`No such note: ${note.path}`);
    return content;
  }

  private addParents(path: string): void {
    const parts = path.split("/").slice(0, -1);
    for (let i = 1; i <= parts.length; i++) this.folders.add(parts.slice(0, i).join("/"));
  }
}

/** DailyNoteRules with fixed settings; understands only the YYYY / MM / DD tokens. */
export class FakeDailyNoteRules implements DailyNoteRules {
  constructor(private readonly settings: unknown = null) {}

  async readSettings(): Promise<unknown> {
    return this.settings;
  }

  readonly matchesFormat = (text: string, format: string): boolean => {
    const pattern = format
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      .replace("YYYY", "\\d{4}")
      .replace("MM", "\\d{2}")
      .replace("DD", "\\d{2}");
    return new RegExp(`^${pattern}$`).test(text);
  };
}
