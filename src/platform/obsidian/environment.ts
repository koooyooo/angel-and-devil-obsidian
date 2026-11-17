import { Platform, getLanguage } from "obsidian";
import { type Strings, stringsFor } from "../../i18n";
import { uiLanguageFor } from "../../lang";
import type { Environment } from "../../ports";
import type { Lang } from "../../types";

function detectUiLanguage(): Lang {
  try {
    return uiLanguageFor(getLanguage());
  } catch {
    return "en";
  }
}

/** Obsidian's UI language mapped to a supported code. */
export const uiLang: Lang = detectUiLanguage();

/**
 * Strings in Obsidian's UI language: for what Obsidian itself shows (settings tab, command names,
 * ribbon / header / status bar tooltips). Everything a launch shows uses
 * `stringsFor(runtimeLanguage(settings.language, env.uiLanguage))`.
 */
export const t: Strings = stringsFor(uiLang);

export function obsidianEnvironment(): Environment {
  return { uiLanguage: uiLang, isMobile: Platform.isMobile };
}
