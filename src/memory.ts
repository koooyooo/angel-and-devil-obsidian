/**
 * Memory (ADR-0004): the characters remember a little across banters.
 *
 * Everything lives in plain notes inside the vault, so the user can read, fix, or delete it:
 *   <folder>/history.md          one line per note and day, with a link to the note (never sent to Gemini)
 *   <folder>/<speakerId>_memo_diary.md    each character's memos about diary notes
 *   <folder>/<speakerId>_memo_content.md  each character's memos about other notes (articles, book notes, …)
 *                                only the last MEMORY_ENTRIES of each are kept; a banter reads and writes the
 *                                memos of its own kind only (see isDiaryNote)
 *   <folder>/<speakerId>_impression.md  each character's overall impression of the user, read and rewritten
 *                                after every banter of either kind; the last IMPRESSION_VERSIONS versions are
 *                                kept, only the newest is sent
 *
 * Memos used to live in <speakerId>_memo.md; that file is taken over as the diary memos (memory-store.ts).
 *
 * A banter is recorded as soon as it is shown. Another banter on the same note on the same day ("Again",
 * or a second run) replaces that day's record instead of adding to it.
 *
 * Pure functions only, so they can be unit tested without Obsidian. Vault I/O is in memory-store.ts.
 */
import type { SpeakerId } from "./types";

export const DEFAULT_MEMORY_FOLDER = "_angel_and_devil";
export const HISTORY_FILE = "history.md";
/** Memos kept per character and kind of note (and sent back to the model). */
export const MEMORY_ENTRIES = 10;

/** What a note is, for memory: a diary entry, or anything else (an article, book note, spec, …). */
export type NoteKind = "diary" | "content";
export const NOTE_KINDS: readonly NoteKind[] = ["diary", "content"];
/** A memo is cut to this length before it is sent, so one entry cannot eat the budget. */
export const MAX_MEMO_CHARS = 600;
/** Impression versions kept per character (older ones only help the user see how it changed). */
export const IMPRESSION_VERSIONS = 3;
/** An impression is cut to this length before it is sent. */
export const MAX_IMPRESSION_CHARS = 1200;

export function memoFileName(id: SpeakerId, kind: NoteKind): string {
  return `${id}_memo_${kind}.md`;
}

/** Where memos were kept before they were split by kind; taken over as the diary memos. */
export function legacyMemoFileName(id: SpeakerId): string {
  return `${id}_memo.md`;
}

export function impressionFileName(id: SpeakerId): string {
  return `${id}_impression.md`;
}

/**
 * Cleans a folder setting into a vault-relative path, or returns null when it cannot be used.
 * Dot folders are refused: Obsidian does not index them, so the user could not see or edit the memory.
 */
export function normalizeMemoryFolder(input: string): string | null {
  const segments = input
    .replace(/\\/g, "/")
    .split("/")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (segments.length === 0) return null;
  if (segments.some((s) => s.startsWith(".") || /[*"<>:|?]/.test(s))) return null;
  return segments.join("/");
}

export function isInFolder(path: string, folder: string): boolean {
  return path === folder || path.startsWith(`${folder}/`);
}

/** Frontmatter key that sets a note's kind (`diary` or `content`), whatever the other rules say. */
export const KIND_FRONTMATTER_KEY = "angel-and-devil-kind";

/** A file name that starts with a calendar date: `2026-11-12`, `2026-11-12 Thursday`, `2026-11-12_work`. */
const DATED_NAME = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])(?!\d)/;

export interface DiaryCheck {
  /** Vault-relative path, e.g. `Daily/2026-11-12.md`. */
  path: string;
  /** File name without the extension. */
  basename: string;
  frontmatter?: Record<string, unknown> | null;
}

/** Obsidian's core Daily notes settings (`<configDir>/daily-notes.json`), as saved: either may be missing or empty. */
export interface DailyNoteSettings {
  folder?: string;
  format?: string;
}

/** Obsidian's own default for the Daily notes date format. */
export const DEFAULT_DAILY_NOTE_FORMAT = "YYYY-MM-DD";

/** Strict date parsing (moment in the plugin): does `text` read as a date in `format`, with nothing left over? */
export type DateFormatMatcher = (text: string, format: string) => boolean;

/**
 * Cleans the raw Daily notes settings. Returns null when there is nothing to go by (the core plugin is off, the
 * file is missing, or both folder and format were left empty), so the dated-file-name rule is used instead.
 */
export function dailyNoteRule(raw: unknown): { folder: string; format: string } | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as DailyNoteSettings;
  const folder = typeof r.folder === "string" ? r.folder.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "").trim() : "";
  const format = typeof r.format === "string" ? r.format.trim() : "";
  if (!folder && !format) return null;
  return { folder, format: format || DEFAULT_DAILY_NOTE_FORMAT };
}

function frontmatterKind(value: unknown): NoteKind | null {
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase();
  return v === "diary" || v === "content" ? v : null;
}

/** A note's kind: a diary entry (isDiaryNote), or content. */
export function noteKind(
  note: DiaryCheck,
  daily: { folder: string; format: string } | null,
  matchesFormat: DateFormatMatcher,
): NoteKind {
  return isDiaryNote(note, daily, matchesFormat) ? "diary" : "content";
}

/**
 * Whether a note is a diary entry. Diary notes and other notes keep separate memos, so articles or book notes
 * do not push diary memos out (the impression of the user is shared).
 *
 * First match wins:
 * 1. the frontmatter kind (`angel-and-devil-kind: diary | content`);
 * 2. with Obsidian's Daily notes settings (`daily`): the note is in its folder and its path below that folder,
 *    without `.md`, reads strictly as a date in its format (a format may contain `/` for subfolders);
 * 3. without them: the file name starts with `YYYY-MM-DD`.
 */
export function isDiaryNote(
  note: DiaryCheck,
  daily: { folder: string; format: string } | null,
  matchesFormat: DateFormatMatcher,
): boolean {
  const kind = frontmatterKind(note.frontmatter?.[KIND_FRONTMATTER_KEY]);
  if (kind !== null) return kind === "diary";
  if (!daily) return DATED_NAME.test(note.basename);
  if (daily.folder && !note.path.startsWith(`${daily.folder}/`)) return false;
  const relative = (daily.folder ? note.path.slice(daily.folder.length + 1) : note.path).replace(/\.md$/i, "");
  return matchesFormat(relative, daily.format);
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function formatDate(now: Date): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function formatStamp(now: Date): string {
  return `${formatDate(now)} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

/**
 * True when a memo heading or history line (`[- ]YYYY-MM-DD HH:mm [[note]] …`) was written on `date`
 * about the note that `isNote(linkTarget)` recognizes. Used to replace instead of append.
 */
export function isSameNoteSameDay(headingOrLine: string, date: string, isNote: (target: string) => boolean): boolean {
  const text = headingOrLine.replace(/^-\s+/, "").trim();
  if (!text.startsWith(date)) return false;
  const target = linkTarget(text);
  return target !== null && isNote(target);
}

export interface MemoEntry {
  /** Heading text after `## `, e.g. `2026-11-12 14:30 [[2026-11-12]]`. */
  heading: string;
  body: string;
}

export interface MemoFile {
  /** Everything before the first entry (title and explanation), kept as the user left it. */
  preamble: string;
  entries: MemoEntry[];
}

const ENTRY_HEADING = /^##[ \t]+(.*)$/;

/** Splits a memo file into entries. Tolerant of hand edits: an entry is a `## ` heading and what follows. */
export function parseMemo(text: string): MemoFile {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const preamble: string[] = [];
  const entries: MemoEntry[] = [];
  let current: { heading: string; body: string[] } | null = null;
  const flush = () => {
    if (!current) return;
    const body = current.body.join("\n").trim();
    if (body) entries.push({ heading: current.heading.trim(), body });
  };
  for (const line of lines) {
    const m = line.match(ENTRY_HEADING);
    if (m) {
      flush();
      current = { heading: m[1], body: [] };
    } else if (current) {
      current.body.push(line);
    } else {
      preamble.push(line);
    }
  }
  flush();
  return { preamble: preamble.join("\n").trim(), entries };
}

export function renderMemo(file: MemoFile): string {
  const parts = file.preamble ? [file.preamble] : [];
  for (const e of file.entries) parts.push(`## ${e.heading}\n\n${e.body}`);
  return `${parts.join("\n\n")}\n`;
}

export interface UpsertOptions {
  /** Entries (by heading) or history lines this one replaces: the same note on the same day. */
  replaces?: (headingOrLine: string) => boolean;
  max?: number;
}

/**
 * Adds an entry at the bottom, after removing the ones it `replaces`, and keeps only the newest `max`.
 * `existing` is null for a new file.
 */
export function appendMemoEntry(
  existing: string | null,
  entry: MemoEntry,
  defaultPreamble: string,
  options: UpsertOptions = {},
): string {
  const file = existing === null ? { preamble: defaultPreamble, entries: [] } : parseMemo(existing);
  const replaces = options.replaces ?? (() => false);
  const kept = file.entries.filter((e) => !replaces(e.heading));
  const entries = [...kept, entry].slice(-(options.max ?? MEMORY_ENTRIES));
  return renderMemo({ preamble: file.preamble, entries });
}

/** Removes the entries matching `replaces`; returns the text untouched when nothing matches. */
export function removeMemoEntries(existing: string, replaces: (heading: string) => boolean): string {
  const file = parseMemo(existing);
  const kept = file.entries.filter((e) => !replaces(e.heading));
  return kept.length === file.entries.length ? existing : renderMemo({ preamble: file.preamble, entries: kept });
}

/**
 * Adds one line at the bottom of history.md, after removing the list lines it `replaces`.
 * Otherwise history is a log: nothing is trimmed.
 */
export function appendHistoryLine(
  existing: string | null,
  line: string,
  defaultPreamble: string,
  options: Pick<UpsertOptions, "replaces"> = {},
): string {
  const replaces = options.replaces ?? (() => false);
  const source = (existing ?? defaultPreamble)
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .filter((l) => !(l.startsWith("- ") && replaces(l)))
    .join("\n");
  const body = source.replace(/\s+$/, "");
  if (!body) return `${line}\n`;
  // Keep the list tight; leave one blank line after a title or paragraph.
  const lastLine = body.slice(body.lastIndexOf("\n") + 1);
  const sep = lastLine.startsWith("- ") ? "\n" : "\n\n";
  return `${body}${sep}${line}\n`;
}

const WIKILINK = /\[\[([^\]|#^]+)(?:[#^][^\]|]*)?(?:\|([^\]]*))?\]\]/g;

/** The first wikilink target in a heading (`[[Daily/2026-11-12|...]]` → `Daily/2026-11-12`). */
export function linkTarget(heading: string): string | null {
  WIKILINK.lastIndex = 0;
  const m = WIKILINK.exec(heading);
  return m ? m[1].trim() : null;
}

/** Heading as plain text for the prompt: links become their target names. */
export function headingAsText(heading: string): string {
  return heading.replace(WIKILINK, (_m, target: string, alias?: string) => (alias ?? target).trim()).trim();
}

export interface PromptMemo {
  when: string;
  text: string;
}

export function toPromptMemo(entry: MemoEntry): PromptMemo {
  const text = entry.body.replace(/\s+/g, " ").trim();
  return {
    when: headingAsText(entry.heading),
    text: text.length > MAX_MEMO_CHARS ? `${text.slice(0, MAX_MEMO_CHARS)}…` : text,
  };
}

/**
 * An impression for the prompt. Unlike a memo it keeps its line breaks (it is usually a short list),
 * but blank lines and trailing spaces are dropped.
 */
export function toPromptImpression(entry: MemoEntry): PromptMemo {
  const text = entry.body
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .join("\n");
  return {
    when: headingAsText(entry.heading),
    text: text.length > MAX_IMPRESSION_CHARS ? `${text.slice(0, MAX_IMPRESSION_CHARS)}…` : text,
  };
}
