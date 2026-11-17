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
import { normalizeVaultPath } from "./path";
import type { DailyNoteRules, NoteRef, NoteStore } from "./ports";
import type { MemorySettings } from "./settings-model";
import type { CharacterSpec, DialogueMemory, Lang, SpeakerId } from "./types";

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
 * MemoryStore (ADR-0004): reads and writes the memory notes through the NoteStore, so they are
 * ordinary, visible, synced notes. Nothing is created until the first banter is shown with memory on.
 */
export class MemoryStore {
  constructor(
    private readonly notes: NoteStore,
    private readonly daily: DailyNoteRules,
    private readonly settings: () => MemorySettings,
  ) {}

  /**
   * The memory to use for a banter on `source`, or null when memory is off. A note inside the memory
   * folder itself never uses memory, so the pair does not react to (or write about) their own memos.
   */
  async useFor(source: NoteRef): Promise<MemoryUse | null> {
    const s = this.settings();
    if (!s.enabled) return null;
    const folder = normalizeVaultPath(s.folder);
    if (isInFolder(source.path, folder)) return null;
    // Read on every banter so a change to the Daily notes settings applies at once.
    const daily = dailyNoteRule(await this.daily.readSettings());
    const kind = noteKind(
      {
        path: source.path,
        basename: source.basename,
        frontmatter: this.notes.frontmatter(source),
      },
      daily && { folder: daily.folder ? normalizeVaultPath(daily.folder) : "", format: daily.format },
      this.daily.matchesFormat,
    );
    return { folder, kind };
  }

  /**
   * Each character's latest memos of `use.kind` (oldest first) and newest impression. Entries written about
   * `source` itself are skipped, so regenerating on a note does not build on what was just said about it:
   * "Again" starts from the impression as it was before this note, instead of folding the same note in twice.
   */
  async load(use: MemoryUse, source: NoteRef, lineup: readonly CharacterSpec[]): Promise<LoadedMemory> {
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
  private async entriesNotAbout(folder: string, name: string, source: NoteRef): Promise<MemoEntry[]> {
    const path = normalizeVaultPath(`${folder}/${name}`);
    const file = this.notes.get(path);
    if (!file) return [];
    return parseMemo(await this.notes.read(file)).entries.filter((e) => {
      const target = linkTarget(e.heading);
      return !target || this.notes.resolveLink(target, path)?.path !== source.path;
    });
  }

  /**
   * Memos used to be one file per character (`<id>_memo.md`). It becomes the diary memos by a plain rename,
   * since its entries are in the same format. When both files exist (copied by hand), nothing is touched.
   */
  private async migrateLegacyMemos(folder: string, lineup: readonly CharacterSpec[]): Promise<void> {
    for (const c of lineup) {
      const legacy = this.notes.get(normalizeVaultPath(`${folder}/${legacyMemoFileName(c.id)}`));
      const target = normalizeVaultPath(`${folder}/${memoFileName(c.id, "diary")}`);
      if (!legacy || this.notes.isTaken(target)) continue;
      await this.notes.rename(legacy, target);
    }
  }

  /**
   * Records a banter as soon as it is shown: one line in history.md, and one memo (of `use.kind`) and one
   * impression version per character. A record for the same note on the same day is replaced, so "Again"
   * never piles up entries; today's memo in the other kind's file goes too, in case the note's kind changed.
   */
  async record(
    use: MemoryUse,
    source: NoteRef,
    lineup: readonly CharacterSpec[],
    memory: DialogueMemory,
    now: Date,
    lang: Lang,
  ): Promise<void> {
    const { folder, kind } = use;
    // Titles and notes of newly created memory files, and the character names in them, follow the launch language.
    const t = stringsFor(lang);
    await this.notes.ensureFolder(folder);
    await this.migrateLegacyMemos(folder, lineup);
    const stamp = formatStamp(now);
    const date = formatDate(now);
    const replacesIn = (fromPath: string) => (headingOrLine: string) =>
      isSameNoteSameDay(headingOrLine, date, (target) => this.isLinkTo(target, fromPath, source));

    const historyPath = normalizeVaultPath(`${folder}/${HISTORY_FILE}`);
    const historyLine = `- ${stamp} ${this.linkTo(source, historyPath)}${memory.summary ? ` ${memory.summary}` : ""}`;
    await this.upsert(historyPath, (existing) =>
      appendHistoryLine(existing, historyLine, `${t.historyTitle}\n\n${t.historyNote}`, {
        replaces: replacesIn(historyPath),
      }),
    );

    for (const c of lineup) {
      const name = charName(c, lang);
      for (const other of NOTE_KINDS) {
        if (other !== kind) await this.removeToday(normalizeVaultPath(`${folder}/${memoFileName(c.id, other)}`), replacesIn);
      }
      await this.upsertEntry(normalizeVaultPath(`${folder}/${memoFileName(c.id, kind)}`), memory.notes[c.id], {
        source,
        stamp,
        replacesIn,
        preamble: `${t.memoTitle(c.emoji, name, kind)}\n\n${t.memoNote(MEMORY_ENTRIES, kind)}`,
        max: MEMORY_ENTRIES,
      });
      await this.upsertEntry(normalizeVaultPath(`${folder}/${impressionFileName(c.id)}`), memory.impressions[c.id], {
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
      source: NoteRef;
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
    const file = this.notes.get(path);
    if (file) await this.notes.process(file, (data) => removeMemoEntries(data, replacesIn(path)));
  }

  /** Whether a link target written in `fromPath` points at `note` (also after a rename, via link resolution). */
  private isLinkTo(target: string, fromPath: string, note: NoteRef): boolean {
    if (target === this.notes.linkText(note, fromPath)) return true;
    return this.notes.resolveLink(target, fromPath)?.path === note.path;
  }

  private linkTo(note: NoteRef, fromPath: string): string {
    return `[[${this.notes.linkText(note, fromPath)}]]`;
  }

  /** NoteStore.process reads and writes atomically, so a concurrent edit by the user is not lost. */
  private async upsert(path: string, update: (existing: string | null) => string): Promise<void> {
    const file = this.notes.get(path);
    if (file) await this.notes.process(file, (data) => update(data));
    else await this.notes.create(path, update(null));
  }
}
