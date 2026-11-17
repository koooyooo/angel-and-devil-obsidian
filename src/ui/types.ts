/**
 * What the controller and the banter screen agree on (design doc §2.2). No Obsidian and no DOM here,
 * so the controller can be tested with a fake screen (doc/feature/platform-ports/dd.md §3.3).
 */
import type { GeminiError } from "../gemini/errors";
import type { Strings } from "../i18n";
import type { CharacterSpec, Dialogue, Lang, RevealSpeed } from "../types";

/** Callbacks to the controller. The modal never calls the generator, writer, etc. itself (design doc §2.2). */
export interface ModalHandlers {
  onSave(): void;
  onRetry(): void;
  onRegenerate(): void;
  onOpenSettings(): void;
  onSpeak(): void;
  onStopAudio(): void;
  /** The user sent their one reply (already normalized, never empty). */
  onReply(text: string): void;
  onClose(): void;
}

export interface ModalOptions {
  animation: boolean;
  revealSpeed: RevealSpeed;
  /** Shows the Read aloud button (Phase 2). */
  tts: boolean;
  /** Shows the reply box once the banter is done (feature: reply). */
  reply: boolean;
  lineup?: readonly [CharacterSpec, CharacterSpec];
  /** Strings and language of the launch (the plugin's language setting; see runtimeLanguage in i18n.ts). */
  strings: Strings;
  lang: Lang;
}

/**
 * How bubbles appear:
 * - "timer": one by one on a timer (click / Space to advance) — text mode.
 * - "audio": one by one as the voice reaches each turn — read-aloud launch.
 */
export type RevealMode = "timer" | "audio";

/** Loading screen steps. "voice" is only shown for the read-aloud launch. */
export type LoadingStep = "write" | "voice";

export type AudioState = "idle" | "loading" | "playing" | "ended";

/** The open banter screen, as the controller drives it. */
export interface DialogueView {
  showLoading(options: { voice: boolean }): void;
  setLoadingStep(step: LoadingStep): void;
  showDialogue(dialogue: Dialogue, options: { truncated: boolean; memoryCount?: number; reveal: RevealMode }): void;
  showReplyLoading(text: string): void;
  showReplyError(error: GeminiError, text: string): void;
  showReply(dialogue: Dialogue, options: { reveal: RevealMode }): void;
  showError(error: GeminiError): void;
  setAudioState(state: AudioState): void;
  setActiveTurn(index: number, level: number): void;
  setSaved(): void;
  /** Close initiated by the controller: does not call onClose back. */
  dismiss(): void;
}

export interface TtsConfirmResult {
  approved: boolean;
  /** The user ticked "Don't ask again" and pressed OK. Always false when cancelled. */
  dontAskAgain: boolean;
}
