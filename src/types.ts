export type SpeakerId = string;
export type Speaker = SpeakerId;
export type SlotRole = "lead" | "counter";
export type Lang = string;
export type VendorId = string;

export interface CharacterTheme {
  /** Primary accent color (frame / bubble shadow / nameplate background). */
  primary: string;
  /** Avatar frame background color. */
  frameBg: string;
  /** Character name text color under the avatar. */
  nameColor: string;
  /** Radial burst color while speaking. */
  burstColor: string;
}

export interface CharacterSpec {
  id: SpeakerId;
  tier: "free" | "pro";
  /** Display names keyed by language code (falls back to `name.en ?? id`). */
  name: Record<Lang, string>;
  /** ASCII speaker identifier sent to Gemini TTS (`"Angel"`, `"Devil"`, etc.). */
  ttsSpeakerName: string;
  emoji: string;
  promptMarkdown: string;
  defaultVoice: string;
  defaultStyle: string;
  theme: CharacterTheme;
  renderAvatar: (parent: HTMLElement, label: string) => SVGSVGElement | HTMLElement;
}

/** Optional pair-specific banter rules injected when two specific characters are paired. */
export interface PairSynergy {
  pair: [SpeakerId, SpeakerId];
  rulesMarkdown: string;
}

export interface Turn {
  speaker: SpeakerId;
  /** Plain text: no speaker labels, no Markdown. */
  text: string;
}

/**
 * A validated banter: alternating speakers, lead character first and last,
 * so the turn count is odd (5 = two exchanges + closing, 7 = three + closing).
 */
export interface Dialogue {
  language: Lang;
  turns: Turn[];
  /** Present only when memory is on and the model filled it in (see src/memory.ts). */
  memory?: DialogueMemory;
}

/** What one banter leaves behind for the memory files when it is saved. */
export interface DialogueMemory {
  /** One-line topic of the note, for history.md (never sent back to the model). */
  summary: string;
  /** Per-character memo, keyed by speaker id. Missing or empty memos are skipped. */
  notes: Record<SpeakerId, string>;
  /**
   * Per-character overall impression of the user, rewritten from the previous one plus today's note.
   * May span several lines (usually a short "- " list). Missing or empty ones are skipped.
   */
  impressions: Record<SpeakerId, string>;
}

export type Rounds = 2 | 3 | "auto";
export type RevealSpeed = "slow" | "normal" | "fast";
