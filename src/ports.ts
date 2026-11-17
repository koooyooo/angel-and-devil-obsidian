/**
 * What the plugin needs from the app it runs in (doc/feature/platform-ports/dd.md §3).
 * Code outside src/platform/ depends on these, never on Obsidian; src/platform/obsidian/ implements them.
 */
import type { Strings } from "./i18n";
import type { DateFormatMatcher } from "./memory";
import type { AadSettings } from "./settings-model";
import type { Lang } from "./types";
import type { DialogueView, ModalHandlers, ModalOptions, TtsConfirmResult } from "./ui/types";

/** Fixed for the session, so passed as a value rather than asked for. */
export interface Environment {
  /** The app's UI language, mapped to a supported code. */
  uiLanguage: Lang;
  isMobile: boolean;
}

export interface HttpRequest {
  url: string;
  method: "GET" | "POST";
  headers: Record<string, string>;
  contentType?: string;
  body?: string;
}

export interface HttpResponse {
  status: number;
  /** Raw body; the caller parses JSON. */
  text: string;
}

export interface HttpClient {
  /**
   * Resolves for every HTTP status, 4xx / 5xx included; rejects only when no response came back.
   * There is no timeout: callers that need one race it themselves.
   */
  request(req: HttpRequest): Promise<HttpResponse>;
}

/**
 * A note. It keeps pointing at the same note when the note is renamed, and `path` is always the current path
 * (a banter saved after a rename still goes to its note). In Obsidian it is the TFile itself.
 */
export interface NoteRef {
  readonly path: string;
  readonly basename: string;
}

/** Notes in the vault (Obsidian: vault, fileManager, metadataCache). Paths are vault-relative and normalized. */
export interface NoteStore {
  /** The file at `path`, or null. */
  get(path: string): NoteRef | null;
  /** False once the note is deleted; true when it was only renamed. */
  exists(note: NoteRef): boolean;
  /** Whether a file or a folder is at `path`. */
  isTaken(path: string): boolean;
  /** Reads the note (a cached copy is fine). */
  read(note: NoteRef): Promise<string>;
  /** Reads and writes in one step, so a concurrent edit is not lost (Vault.process). */
  process(note: NoteRef, update: (data: string) => string): Promise<void>;
  create(path: string, data: string): Promise<NoteRef>;
  /** Creates the folder and any missing parents; rejects when a file is in the way. */
  ensureFolder(path: string): Promise<void>;
  /** Renames the note and updates links to it in other notes. */
  rename(note: NoteRef, newPath: string): Promise<void>;
  frontmatter(note: NoteRef): Record<string, unknown> | undefined;
  /** What goes inside `[[ ]]` to link to `note` from the note at `fromPath`. */
  linkText(note: NoteRef, fromPath: string): string;
  /** Where `[[target]]`, written in the note at `fromPath`, points. */
  resolveLink(target: string, fromPath: string): NoteRef | null;
}

/** Obsidian's core Daily notes plugin: its settings, and the date format check they need. */
export interface DailyNoteRules {
  /** The raw settings (cleaned by dailyNoteRule in memory.ts), or null when the plugin is off or unreadable. */
  readSettings(): Promise<unknown>;
  /** Whether `text` reads strictly as a date in `format` (a moment format). */
  matchesFormat: DateFormatMatcher;
}

/** Plugin settings (Obsidian: data.json via loadData / saveData). */
export interface SettingsStore {
  /** The live settings object. Change it, then call save() (the same use as plugin.settings). */
  get(): AadSettings;
  save(): Promise<void>;
}

/** The Gemini API key. Kept apart from the settings: it must not end up in synced plain files if avoidable. */
export interface SecretStore {
  /** Whether the key is in the app's secret storage, rather than the plain settings file (shown in settings). */
  readonly secure: boolean;
  /** The key, or "" when none is set. */
  get(): string;
  set(value: string): Promise<void>;
  clear(): Promise<void>;
}

/** Short notices (Obsidian: Notice). */
export interface Notifier {
  notify(message: string): void;
}

/** The screens a banter opens. */
export interface DialogueUi {
  /** Opens the banter screen. */
  openDialogue(handlers: ModalHandlers, options: ModalOptions): DialogueView;
  /**
   * Billing confirmation before TTS (F-6.2). `onApprove` runs synchronously inside the OK click,
   * so audio can be unlocked within the gesture (iOS).
   */
  confirmTts(info: { model: string; turns: string }, onApprove: () => void, strings: Strings): Promise<TtsConfirmResult>;
  /** Opens this plugin's settings. Does nothing where that is not possible. */
  openSettings(): void;
}

/** What a launch works on: made by the entry point (command, ribbon, header button) from the open note. */
export interface LaunchSource {
  note: NoteRef;
  /** The whole note. */
  text: string;
  /** The selection, or "" when nothing is selected. */
  selection: string;
}
