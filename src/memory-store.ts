import { App, TFile, normalizePath } from "obsidian";
import { charName } from "./characters";
import { t, uiLang } from "./i18n";
import {
  HISTORY_FILE,
  IMPRESSION_VERSIONS,
  MEMORY_ENTRIES,
  type MemoEntry,
  type PromptMemo,
  appendHistoryLine,
  appendMemoEntry,
  formatDate,
  formatStamp,
  impressionFileName,
  isInFolder,
  isSameNoteSameDay,
  linkTarget,
  memoFileName,
  parseMemo,
  removeMemoEntries,
  toPromptImpression,
  toPromptMemo,
} from "./memory";
import type { MemorySettings } from "./settings";
import type { CharacterSpec, DialogueMemory, SpeakerId } from "./types";

export interface LoadedMemory {
  memos: Record<SpeakerId, PromptMemo[]>;
  /** Each character's newest impression of the user (missing until the first banter writes one). */
  impressions: Record<SpeakerId, PromptMemo>;
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
   * Each character's latest memos (oldest first) and newest impression. Entries written about `source`
   * itself are skipped, so regenerating on a note does not build on what was just said about it: "Again"
   * starts from the impression as it was before this note, instead of folding the same note in twice.
   */
  async load(folder: string, source: TFile, lineup: readonly CharacterSpec[]): Promise<LoadedMemory> {
    const memos: Record<SpeakerId, PromptMemo[]> = {};
    const impressions: Record<SpeakerId, PromptMemo> = {};
    let count = 0;
    for (const c of lineup) {
      const latest = (await this.entriesNotAbout(folder, memoFileName(c.id), source))
        .slice(-MEMORY_ENTRIES)
        .map(toPromptMemo);
      if (latest.length > 0) {
        memos[c.id] = latest;
        count += latest.length;
      }
      const newest = (await this.entriesNotAbout(folder, impressionFileName(c.id), source)).pop();
      if (newest) impressions[c.id] = toPromptImpression(newest);
    }
    return { memos, impressions, count };
  }

  /** Entries of a memo-format file in `folder`, minus the ones whose heading links to `source`. */
  private async entriesNotAbout(folder: string, name: string, source: TFile): Promise<MemoEntry[]> {
    const path = normalizePath(`${folder}/${name}`);
    const file = this.app.vault.getFileByPath(path);
    if (!file) return [];
    return parseMemo(await this.app.vault.cachedRead(file)).entries.filter((e) => {
      const target = linkTarget(e.heading);
      return !target || this.app.metadataCache.getFirstLinkpathDest(target, path)?.path !== source.path;
    });
  }

  /**
   * Records a banter as soon as it is shown: one line in history.md, and one memo and one impression
   * version per character. A record for the same note on the same day is replaced, so "Again" never
   * piles up entries.
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
      const name = charName(c, uiLang);
      await this.upsertEntry(normalizePath(`${folder}/${memoFileName(c.id)}`), memory.notes[c.id], {
        source,
        stamp,
        replacesIn,
        preamble: `${t.memoTitle(c.emoji, name)}\n\n${t.memoNote(MEMORY_ENTRIES)}`,
        max: MEMORY_ENTRIES,
      });
      await this.upsertEntry(normalizePath(`${folder}/${impressionFileName(c.id)}`), memory.impressions[c.id], {
        source,
        stamp,
        replacesIn,
        preamble: `${t.impressionTitle(c.emoji, name)}\n\n${t.impressionNote(IMPRESSION_VERSIONS)}`,
        max: IMPRESSION_VERSIONS,
      });
    }
  }

  /**
   * Adds `body` as a new entry of the memo-format file at `path`, replacing today's entry for `source`.
   * With no body, still drops today's entry from a discarded banter on this note.
   */
  private async upsertEntry(
    path: string,
    body: string | undefined,
    o: {
      source: TFile;
      stamp: string;
      replacesIn: (fromPath: string) => (heading: string) => boolean;
      preamble: string;
      max: number;
    },
  ): Promise<void> {
    if (!body) {
      const file = this.app.vault.getFileByPath(path);
      if (file) await this.app.vault.process(file, (data) => removeMemoEntries(data, o.replacesIn(path)));
      return;
    }
    await this.upsert(path, (existing) =>
      appendMemoEntry(existing, { heading: `${o.stamp} ${this.linkTo(o.source, path)}`, body }, o.preamble, {
        replaces: o.replacesIn(path),
        max: o.max,
      }),
    );
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
