import { App, TFile, normalizePath } from "obsidian";
import { charName } from "./characters";
import { t, uiLang } from "./i18n";
import {
  HISTORY_FILE,
  MEMORY_ENTRIES,
  type PromptMemo,
  appendHistoryLine,
  appendMemoEntry,
  formatDate,
  formatStamp,
  isInFolder,
  isSameNoteSameDay,
  linkTarget,
  memoFileName,
  parseMemo,
  removeMemoEntries,
  toPromptMemo,
} from "./memory";
import type { MemorySettings } from "./settings";
import type { CharacterSpec, DialogueMemory, SpeakerId } from "./types";

export interface LoadedMemory {
  memos: Record<SpeakerId, PromptMemo[]>;
  /** Total memos across both characters (for the "drawing on N memos" notice). */
  count: number;
}

/**
 * MemoryStore (ADR-0004): reads and writes the memory notes through the Vault API, so they are
 * ordinary, visible, synced notes. Nothing is created until the first banter is shown with memory on.
 */
export class MemoryStore {
  constructor(
    private readonly app: App,
    private readonly settings: () => MemorySettings,
  ) {}

  /**
   * The folder to use for a banter on `source`, or null when memory is off. A note inside the memory
   * folder itself never uses memory, so the pair does not react to (or write about) their own memos.
   */
  folderFor(source: TFile): string | null {
    const s = this.settings();
    if (!s.enabled) return null;
    const folder = normalizePath(s.folder);
    return isInFolder(source.path, folder) ? null : folder;
  }

  /**
   * Each character's latest memos, oldest first. Memos written about `source` itself are skipped,
   * so regenerating on a saved note does not bring up what was just said about it.
   */
  async load(folder: string, source: TFile, lineup: readonly CharacterSpec[]): Promise<LoadedMemory> {
    const memos: Record<SpeakerId, PromptMemo[]> = {};
    let count = 0;
    for (const c of lineup) {
      const path = normalizePath(`${folder}/${memoFileName(c.id)}`);
      const file = this.app.vault.getFileByPath(path);
      if (!file) continue;
      const entries = parseMemo(await this.app.vault.cachedRead(file)).entries.filter((e) => {
        const target = linkTarget(e.heading);
        return !target || this.app.metadataCache.getFirstLinkpathDest(target, path)?.path !== source.path;
      });
      const latest = entries.slice(-MEMORY_ENTRIES).map(toPromptMemo);
      if (latest.length === 0) continue;
      memos[c.id] = latest;
      count += latest.length;
    }
    return { memos, count };
  }

  /**
   * Records a banter as soon as it is shown: one line in history.md and one memo per character.
   * A record for the same note on the same day is replaced, so "Again" never piles up entries.
   */
  async record(
    folder: string,
    source: TFile,
    lineup: readonly CharacterSpec[],
    memory: DialogueMemory,
    now: Date,
  ): Promise<void> {
    await this.ensureFolder(folder);
    const stamp = formatStamp(now);
    const date = formatDate(now);
    const replacesIn = (fromPath: string) => (headingOrLine: string) =>
      isSameNoteSameDay(headingOrLine, date, (target) => this.isLinkTo(target, fromPath, source));

    const historyPath = normalizePath(`${folder}/${HISTORY_FILE}`);
    const historyLine = `- ${stamp} ${this.linkTo(source, historyPath)}${memory.summary ? ` ${memory.summary}` : ""}`;
    await this.upsert(historyPath, (existing) =>
      appendHistoryLine(existing, historyLine, `${t.historyTitle}\n\n${t.historyNote}`, {
        replaces: replacesIn(historyPath),
      }),
    );

    for (const c of lineup) {
      const path = normalizePath(`${folder}/${memoFileName(c.id)}`);
      const note = memory.notes[c.id];
      if (!note) {
        // No memo this time: still drop today's memo from a discarded banter on this note.
        const file = this.app.vault.getFileByPath(path);
        if (file) await this.app.vault.process(file, (data) => removeMemoEntries(data, replacesIn(path)));
        continue;
      }
      const preamble = `${t.memoTitle(c.emoji, charName(c, uiLang))}\n\n${t.memoNote(MEMORY_ENTRIES)}`;
      await this.upsert(path, (existing) =>
        appendMemoEntry(existing, { heading: `${stamp} ${this.linkTo(source, path)}`, body: note }, preamble, {
          replaces: replacesIn(path),
        }),
      );
    }
  }

  /** Whether a link target written in `fromPath` points at `file` (also after a rename, via the cache). */
  private isLinkTo(target: string, fromPath: string, file: TFile): boolean {
    if (target === this.app.metadataCache.fileToLinktext(file, fromPath)) return true;
    return this.app.metadataCache.getFirstLinkpathDest(target, fromPath)?.path === file.path;
  }

  private linkTo(file: TFile, fromPath: string): string {
    return `[[${this.app.metadataCache.fileToLinktext(file, fromPath)}]]`;
  }

  /** Vault.process reads and writes atomically, so a concurrent edit by the user is not lost. */
  private async upsert(path: string, update: (existing: string | null) => string): Promise<void> {
    const file = this.app.vault.getFileByPath(path);
    if (file) await this.app.vault.process(file, (data) => update(data));
    else await this.app.vault.create(path, update(null));
  }

  private async ensureFolder(folder: string): Promise<void> {
    let path = "";
    for (const segment of folder.split("/")) {
      path = path ? `${path}/${segment}` : segment;
      if (this.app.vault.getFolderByPath(path)) continue;
      if (this.app.vault.getAbstractFileByPath(path)) throw new Error(`Not a folder: ${path}`);
      await this.app.vault.createFolder(path);
    }
  }
}
