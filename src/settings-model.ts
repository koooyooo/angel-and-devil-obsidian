/**
 * Plugin settings: types, defaults and how saved data is read (design doc §4.1, ADR-0003).
 * No Obsidian here; the settings tab (settings.ts) and SettingsStore build on it.
 */
import { ALL_CHARACTERS, DEFAULT_LINEUP } from "./characters";
import { DEFAULT_HEADING_TEMPLATE, LEGACY_HEADING_TEMPLATES } from "./format";
import { isSupportedLanguage } from "./lang";
import { DEFAULT_MEMORY_FOLDER, normalizeMemoryFolder } from "./memory";
import type { Lang, RevealSpeed, Rounds, SpeakerId, VendorId } from "./types";

export const CURRENT_SCHEMA_VERSION = 1;

export interface AadSettings {
  /** Monotonically increasing integer; bumped only on breaking schema changes (ADR-0003). */
  schemaVersion: number;
  /** Only used when the app has no secret storage (Obsidian < 1.11.4); see SecretStore. */
  apiKey: string;
  textVendor: VendorId;
  textModel: string;
  language: "auto" | Lang;
  rounds: Rounds;
  /** Two-slot character lineup `[leadId, counterId]`. Defaults to `["angel", "devil"]`. */
  lineup: [SpeakerId, SpeakerId];
  animation: boolean;
  revealSpeed: RevealSpeed;
  headingTemplate: string;
  showRibbon: boolean;
  showStatusBar: boolean;
  maxInputChars: number;
  tts: TtsSettings;
  memory: MemorySettings;
  reply: ReplySettings;
}

/** One reply from the user after a banter (feature: reply). On by default. */
export interface ReplySettings {
  enabled: boolean;
}

/** Memory across banters (ADR-0004). Off by default; the files live in a visible vault folder. */
export interface MemorySettings {
  enabled: boolean;
  /** Vault-relative folder. Never a dot folder (see normalizeMemoryFolder). */
  folder: string;
}

export interface TtsSettings {
  enabled: boolean;
  vendor: VendorId;
  model: string;
  confirmEveryTime: boolean;
  autoplay: boolean;
  speed: Record<Lang, number>;
  voices: Record<SpeakerId, string>;
  styles: Record<SpeakerId, string>;
}

/** Prebuilt Gemini TTS voices (dot-agent skill: references/Voices.md). */
export const VOICES = [
  "Achernar", "Achird", "Algenib", "Algieba", "Alnilam", "Aoede", "Autonoe", "Callirrhoe", "Charon", "Despina",
  "Enceladus", "Erinome", "Fenrir", "Gacrux", "Iapetus", "Kore", "Laomedeia", "Leda", "Orus", "Pulcherrima",
  "Puck", "Rasalgethi", "Sadachbia", "Sadaltager", "Schedar", "Sulafat", "Umbriel", "Vindemiatrix", "Zephyr",
  "Zubenelgenubi",
] as const;

export const DEFAULT_SETTINGS: AadSettings = {
  schemaVersion: CURRENT_SCHEMA_VERSION,
  apiKey: "",
  textVendor: "gemini",
  // Alias that follows Google's current Flash model (PRD §12.2: the default is still to be decided).
  textModel: "gemini-flash-latest",
  language: "auto",
  rounds: "auto",
  lineup: [DEFAULT_LINEUP[0].id, DEFAULT_LINEUP[1].id],
  animation: true,
  revealSpeed: "normal",
  headingTemplate: DEFAULT_HEADING_TEMPLATE,
  showRibbon: true,
  showStatusBar: false,
  maxInputChars: 20_000,
  // Defaults mirror the CLI skill's settings.yaml.
  tts: {
    enabled: false,
    vendor: "gemini",
    model: "gemini-3.8-flash-tts",
    confirmEveryTime: true,
    autoplay: false,
    speed: { ja: 1.2, en: 1.1 },
    // Every character's own defaults (src/characters/<id>/spec.ts); saved values are merged over these.
    voices: Object.fromEntries(ALL_CHARACTERS.map((c) => [c.id, c.defaultVoice])),
    styles: Object.fromEntries(ALL_CHARACTERS.map((c) => [c.id, c.defaultStyle])),
  },
  memory: {
    enabled: false,
    folder: DEFAULT_MEMORY_FOLDER,
  },
  reply: {
    enabled: true,
  },
};

function isValidLineup(value: unknown): value is [SpeakerId, SpeakerId] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === "string" &&
    typeof value[1] === "string" &&
    value[0].trim().length > 0 &&
    value[1].trim().length > 0 &&
    value[0] !== value[1]
  );
}

/** Deep-merges saved data over the defaults so new fields appear after an update (design doc §4.1, ADR-0003). */
export function mergeSettings(saved: unknown): AadSettings {
  const s = saved && typeof saved === "object" ? (saved as Partial<AadSettings>) : {};
  const d = DEFAULT_SETTINGS.tts;
  const tts = (s.tts ?? {}) as Partial<TtsSettings>;
  const schemaVersion =
    typeof s.schemaVersion === "number" && Number.isInteger(s.schemaVersion) && s.schemaVersion >= 1
      ? s.schemaVersion
      : CURRENT_SCHEMA_VERSION;
  const textVendor =
    typeof s.textVendor === "string" && s.textVendor.trim().length > 0
      ? s.textVendor.trim()
      : DEFAULT_SETTINGS.textVendor;
  const lineup: [SpeakerId, SpeakerId] = isValidLineup(s.lineup)
    ? [s.lineup[0], s.lineup[1]]
    : [...DEFAULT_SETTINGS.lineup];
  const ttsVendor =
    typeof tts.vendor === "string" && tts.vendor.trim().length > 0 ? tts.vendor.trim() : d.vendor;
  const memory = (s.memory ?? {}) as Partial<MemorySettings>;
  const reply = (s.reply ?? {}) as Partial<ReplySettings>;
  const memoryFolder =
    (typeof memory.folder === "string" && normalizeMemoryFolder(memory.folder)) || DEFAULT_SETTINGS.memory.folder;

  return {
    ...DEFAULT_SETTINGS,
    ...s,
    schemaVersion,
    apiKey: typeof s.apiKey === "string" ? s.apiKey : DEFAULT_SETTINGS.apiKey,
    textVendor,
    language: isSupportedLanguage(s.language) ? s.language : "auto",
    // Earlier defaults had a fixed title; treat them as "not customized" so the title follows the language.
    headingTemplate:
      typeof s.headingTemplate !== "string" || LEGACY_HEADING_TEMPLATES.includes(s.headingTemplate)
        ? DEFAULT_SETTINGS.headingTemplate
        : s.headingTemplate,
    lineup,
    tts: {
      ...d,
      ...tts,
      vendor: ttsVendor,
      speed: { ...d.speed, ...(tts.speed ?? {}) },
      voices: { ...d.voices, ...(tts.voices ?? {}) },
      styles: { ...d.styles, ...(tts.styles ?? {}) },
    },
    memory: {
      enabled: memory.enabled === true,
      folder: memoryFolder,
    },
    reply: {
      enabled: reply.enabled !== false,
    },
  };
}

/** Whether an API key is set. */
export function hasApiKey(key: string): boolean {
  return key.trim().length > 0;
}

/** Last four characters, for "saved (••••abcd)" — never the whole key. Nothing for very short values. */
export function apiKeyHint(key: string): string {
  const k = key.trim();
  return k.length > 8 ? k.slice(-4) : "";
}
