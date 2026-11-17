import { type App, TFile, moment } from "obsidian";
import type { DailyNoteRules, NoteRef, NoteStore } from "../../ports";

/** Notes handed out by ObsidianNoteStore are TFiles; anything else is a programming error. */
function asFile(note: NoteRef): TFile {
  if (!(note instanceof TFile)) throw new Error("Not an Obsidian note");
  return note;
}

/** NoteStore over the vault. A TFile follows renames, which is what NoteRef asks for. */
export class ObsidianNoteStore implements NoteStore {
  constructor(private readonly app: App) {}

  get(path: string): NoteRef | null {
    return this.app.vault.getFileByPath(path);
  }

  exists(note: NoteRef): boolean {
    // A renamed file keeps the same TFile; a deleted one is no longer resolvable.
    const file = asFile(note);
    return this.app.vault.getAbstractFileByPath(file.path) === file;
  }

  isTaken(path: string): boolean {
    return this.app.vault.getAbstractFileByPath(path) !== null;
  }

  read(note: NoteRef): Promise<string> {
    return this.app.vault.cachedRead(asFile(note));
  }

  async process(note: NoteRef, update: (data: string) => string): Promise<void> {
    await this.app.vault.process(asFile(note), update);
  }

  create(path: string, data: string): Promise<NoteRef> {
    return this.app.vault.create(path, data);
  }

  async ensureFolder(folder: string): Promise<void> {
    let path = "";
    for (const segment of folder.split("/")) {
      path = path ? `${path}/${segment}` : segment;
      if (this.app.vault.getFolderByPath(path)) continue;
      if (this.app.vault.getAbstractFileByPath(path)) throw new Error(`Not a folder: ${path}`);
      await this.app.vault.createFolder(path);
    }
  }

  rename(note: NoteRef, newPath: string): Promise<void> {
    return this.app.fileManager.renameFile(asFile(note), newPath);
  }

  frontmatter(note: NoteRef): Record<string, unknown> | undefined {
    return this.app.metadataCache.getFileCache(asFile(note))?.frontmatter;
  }

  linkText(note: NoteRef, fromPath: string): string {
    return this.app.metadataCache.fileToLinktext(asFile(note), fromPath);
  }

  resolveLink(target: string, fromPath: string): NoteRef | null {
    return this.app.metadataCache.getFirstLinkpathDest(target, fromPath);
  }
}

/**
 * Obsidian's bundled moment. Its typing (`typeof import * as Moment`) is not callable under esModuleInterop,
 * although the runtime value is the moment function.
 */
const parseDate = moment as unknown as (text: string, format: string, strict: boolean) => { isValid(): boolean };

/** Daily notes settings read from the config folder on every call, so a change there applies at once. */
export class ObsidianDailyNoteRules implements DailyNoteRules {
  constructor(private readonly app: App) {}

  readonly matchesFormat = (text: string, format: string): boolean => parseDate(text, format, true).isValid();

  /** Null when the core plugin is turned off or nothing can be read; isDiaryNote then falls back to dated names. */
  async readSettings(): Promise<unknown> {
    const configDir = this.app.vault.configDir;
    const corePlugins = await this.readJson(`${configDir}/core-plugins.json`);
    // Newer Obsidian saves { id: enabled }, older an array of enabled ids. Missing = the defaults (Daily notes on).
    if (Array.isArray(corePlugins)) {
      if (!corePlugins.includes("daily-notes")) return null;
    } else if (corePlugins && typeof corePlugins === "object") {
      if ((corePlugins as Record<string, unknown>)["daily-notes"] === false) return null;
    }
    return this.readJson(`${configDir}/daily-notes.json`);
  }

  private async readJson(path: string): Promise<unknown> {
    try {
      if (!(await this.app.vault.adapter.exists(path))) return null;
      return JSON.parse(await this.app.vault.adapter.read(path)) as unknown;
    } catch {
      return null;
    }
  }
}
