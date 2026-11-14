import type { Lang } from "./types";

/**
 * Banter languages the plugin offers. The model identifies the note's language itself ("auto") and reports
 * one of these codes in the response; `name` is how the prompt refers to it, `native` is the settings label.
 */
export const LANGUAGES = [
  { code: "ja", name: "Japanese", native: "日本語" },
  { code: "en", name: "English", native: "English" },
  { code: "zh-Hans", name: "Simplified Chinese", native: "简体中文" },
  { code: "zh-Hant", name: "Traditional Chinese", native: "繁體中文" },
  { code: "fr", name: "French", native: "Français" },
  { code: "es", name: "Spanish", native: "Español" },
  { code: "de", name: "German", native: "Deutsch" },
] as const;

export const LANGUAGE_CODES: readonly Lang[] = LANGUAGES.map((l) => l.code);

export function isSupportedLanguage(value: unknown): value is Lang {
  return typeof value === "string" && LANGUAGE_CODES.includes(value);
}

/** English name used in prompts, e.g. "Simplified Chinese". Unknown codes are returned as is. */
export function languageName(code: Lang): string {
  return LANGUAGES.find((l) => l.code === code)?.name ?? code;
}

/**
 * Maps Obsidian's UI language (`getLanguage()`, e.g. "ja", "zh", "zh-TW", "fr") to one of LANGUAGES.
 * Obsidian uses "zh" for Simplified and "zh-TW" for Traditional Chinese; anything unsupported is English.
 */
export function uiLanguageFor(obsidianLanguage: string): Lang {
  const code = obsidianLanguage.trim().toLowerCase().replace(/_/g, "-");
  if (code.startsWith("zh")) return /^zh-(tw|hk|mo|hant)/.test(code) ? "zh-Hant" : "zh-Hans";
  const base = code.split("-")[0];
  return isSupportedLanguage(base) ? base : "en";
}

const KANA = /[぀-ヿ]/;
const HAN = /[㐀-䶿一-鿿]/;

/**
 * Cheap guess used only as a fallback when the model's answer carries no supported language code.
 * The real detection is done by the model (see buildUserMessage). Kana => Japanese; Han ideographs without
 * kana => Chinese (simplified, as the more common script); anything else => English.
 */
export function detectLanguage(text: string): Lang {
  if (KANA.test(text)) return "ja";
  if (HAN.test(text)) return "zh-Hans";
  return "en";
}
