import { App, TFile, moment, normalizePath } from "obsidian";
import { charName } from "./characters";
import { stringsFor } from "./i18n";
import {
  HISTORY_FILE,
  IMPRESSION_VERSIONS,
  MEMORY_ENTRIES,
  NOTE_KINDS,
  type MemoEntry,
  type NoteKind,
  type PromptMemo,
  appendHistoryLine,
  appendMemoEntry,
  dailyNoteRule,
  formatDate,
  formatStamp,
  impressionFileName,
  isInFolder,
  isSameNoteSameDay,
  legacyMemoFileName,
  linkTarget,
  memoFileName,
  noteKind,
  parseMemo,
  removeMemoEntries,
  toPromptImpression,
  toPromptMemo,
} from "./memory";
import type { MemorySettings } from "./settings";
import type { CharacterSpec, DialogueMemory, Lang, SpeakerId } from "./types";

/**
 * Obsidian's bundled moment. Its typing (`typeof import * as Moment`) is not callable under esModuleInterop,
 * although the runtime value is the moment function.
 */
const parseDate = moment as unknown as (text: string, format: string, strict: boolean) => { isValid(): boolean };

export interface LoadedMemory {
  /** Each character's memos about notes of the same kind as this one. */
  memos: Record<SpeakerId, PromptMemo[]>;
  /** Each character's newest impression of the user (missing until the first banter writes one). */
  impressions: Record<SpeakerId, PromptMemo>;
  /** Total memos across both characters (for the "drawing on N memos" notice). */
  count: number;
}

/** Where a banter's memory goes: the memory folder, and which memos (diary or content) it reads and writes. */
export interface MemoryUse {
  folder: string;
  kind: NoteKind;
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
   * The memory to use for a banter on `source`, or null when memory is off. A note inside the memory
   * folder itself never uses memory, so the pair does not react to (or write about) their own memos.
   */
  async useFor(source: TFile): Promise<MemoryUse | null> {
    const s = this.settings();
    if (!s.enabled) return null;
    const folder = normalizePath(s.folder);
    if (isInFolder(source.path, folder)) return null;
    const daily = dailyNoteRule(await this.readDailyNoteSettings());
    const kind = noteKind(
      {
        path: source.path,
        basename: source.basename,
        frontmatter: this.app.metadataCache.getFileCache(source)?.frontmatter,
      },
      daily && { folder: daily.folder ? normalizePath(daily.folder) : "", format: daily.format },
      (text, format) => parseDate(text, format, true).isValid(),
    );
    return { folder, kind };
  }

  /**
   * Obsidian's core Daily notes settings, read on every banter so a change there applies at once.
   * Null when the core plugin is turned off or nothing can be read; isDiaryNote then falls back to dated names.
   */
  private async readDailyNoteSettings(): Promise<unknown> {
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

  /**
   * Each character's latest memos of `use.kind` (oldest first) and newest impression. Entries written about
   * `source` itself are skipped, so regenerating on a note does not build on what was just said about it:
   * "Again" starts from the impression as it was before this note, instead of folding the same note in twice.
   */
  async load(use: MemoryUse, source: TFile, lineup: readonly CharacterSpec[]): Promise<LoadedMemory> {
    await this.migrateLegacyMemos(use.folder, lineup);
    const memos: Record<SpeakerId, PromptMemo[]> = {};
    const impressions: Record<SpeakerId, PromptMemo> = {};
    let count = 0;
    for (const c of lineup) {
      const latest = (await this.entriesNotAbout(use.folder, memoFileName(c.id, use.kind), source))
        .slice(-MEMORY_ENTRIES)
        .map(toPromptMemo);
      if (latest.length > 0) {
        memos[c.id] = latest;
        count += latest.length;
      }
      const newest = (await this.entriesNotAbout(use.folder, impressionFileName(c.id), source)).pop();
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
   * Memos used to be one file per character (`<id>_memo.md`). It becomes the diary memos by a plain rename,
   * since its entries are in the same format. When both files exist (copied by hand), nothing is touched.
   */
  private async migrateLegacyMemos(folder: string, lineup: readonly CharacterSpec[]): Promise<void> {
    for (const c of lineup) {
      const legacy = this.app.vault.getFileByPath(normalizePath(`${folder}/${legacyMemoFileName(c.id)}`));
      const target = normalizePath(`${folder}/${memoFileName(c.id, "diary")}`);
      if (!legacy || this.app.vault.getAbstractFileByPath(target)) continue;
      await this.app.fileManager.renameFile(legacy, target);
    }
  }

  /**
   * Records a banter as soon as it is shown: one line in history.md, and one memo (of `use.kind`) and one
   * impression version per character. A record for the same note on the same day is replaced, so "Again"
   * never piles up entries; today's memo in the other kind's file goes too, in case the note's kind changed.
   */
  async record(
    use: MemoryUse,
    source: TFile,
    lineup: readonly CharacterSpec[],
    memory: DialogueMemory,
    now: Date,
    lang: Lang,
  ): Promise<void> {
    const { folder, kind } = use;
    // Titles and notes of newly created memory files, and the character names in them, follow the launch language.
    const t = stringsFor(lang);
    await this.ensureFolder(folder);
    await this.migrateLegacyMemos(folder, lineup);
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
      const name = charName(c, lang);
      for (const other of NOTE_KINDS) {
        if (other !== kind) await this.removeToday(normalizePath(`${folder}/${memoFileName(c.id, other)}`), replacesIn);
      }
      await this.upsertEntry(normalizePath(`${folder}/${memoFileName(c.id, kind)}`), memory.notes[c.id], {
        source,
        stamp,
        replacesIn,
        preamble: `${t.memoTitle(c.emoji, name, kind)}\n\n${t.memoNote(MEMORY_ENTRIES, kind)}`,
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
      await this.removeToday(path, o.replacesIn);
      return;
    }
    await this.upsert(path, (existing) =>
      appendMemoEntry(existing, { heading: `${o.stamp} ${this.linkTo(o.source, path)}`, body }, o.preamble, {
        replaces: o.replacesIn(path),
        max: o.max,
      }),
    );
  }

  /** Drops today's entry for the source note from the memo-format file at `path`, if there is one. */
  private async removeToday(
    path: string,
    replacesIn: (fromPath: string) => (heading: string) => boolean,
  ): Promise<void> {
    const file = this.app.vault.getFileByPath(path);
    if (file) await this.app.vault.process(file, (data) => removeMemoEntries(data, replacesIn(path)));
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
