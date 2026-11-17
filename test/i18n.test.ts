import { describe, expect, it } from "vitest";
import { DEFAULT_HEADING_TEMPLATE, LEGACY_HEADING_TEMPLATES, renderHeading } from "../src/format";
import { runtimeLanguage, stringsFor } from "../src/i18n";
import { LANGUAGE_CODES, uiLanguageFor } from "../src/lang";
import { de } from "../src/locales/de";
import { es } from "../src/locales/es";
import { fr } from "../src/locales/fr";
import { zhHans } from "../src/locales/zh-Hans";
import { zhHant } from "../src/locales/zh-Hant";
import { DEFAULT_SETTINGS, mergeSettings } from "../src/settings-model";

describe("uiLanguageFor", () => {
  it.each([
    ["ja", "ja"],
    ["en", "en"],
    ["en-GB", "en"],
    ["zh", "zh-Hans"],
    ["zh-CN", "zh-Hans"],
    ["zh-TW", "zh-Hant"],
    ["zh_HK", "zh-Hant"],
    ["fr", "fr"],
    ["es", "es"],
    ["de", "de"],
    ["ko", "en"],
    ["", "en"],
  ])("maps Obsidian's %j to %j", (input, expected) => {
    expect(uiLanguageFor(input)).toBe(expected);
  });
  it("only returns supported codes", () => {
    for (const code of ["pt-BR", "it", "ru", "zh-SG"]) expect(LANGUAGE_CODES).toContain(uiLanguageFor(code));
  });
});

describe("locales", () => {
  const reference = stringsFor("en");
  const locales = { zhHans, zhHant, fr, es, de };

  it.each(Object.entries(locales))("%s has no empty strings and as many tips as English", (_, strings) => {
    for (const [key, value] of Object.entries(strings)) {
      if (typeof value === "string") expect(value.trim(), key).not.toBe("");
    }
    expect(strings.loadingTips).toHaveLength(reference.loadingTips.length);
    for (const tip of strings.loadingTips) expect(tip.trim()).not.toBe("");
  });

  it.each(Object.entries(locales))("%s formats the memory file headings", (_, strings) => {
    expect(strings.memoTitle("😇", "Angel", "diary")).toMatch(/^# 😇 /);
    expect(strings.impressionTitle("😈", "Devil")).toMatch(/^# 😈 /);
    expect(strings.memoNote(30, "content")).toMatch(/^%% .*30.* %%$/);
    expect(strings.memoryUsed(2)).toContain("2");
  });

  it.each(Object.entries(locales))("%s puts the character name into the TTS voice / style labels", (_, strings) => {
    expect(strings.setTtsVoice("Sage")).toContain("Sage");
    expect(strings.setTtsStyle("Sage")).toContain("Sage");
  });
});

describe("runtimeLanguage", () => {
  it("uses the plugin's language when fixed, and the app's UI language for auto", () => {
    expect(runtimeLanguage("es", "ja")).toBe("es");
    expect(runtimeLanguage("zh-Hant", "en")).toBe("zh-Hant");
    expect(runtimeLanguage("auto", "en")).toBe("en");
    expect(runtimeLanguage("auto", "ja")).toBe("ja");
  });
  it("hands out the matching strings", () => {
    expect(stringsFor(runtimeLanguage("de", "en")).tipLabel).toBe("Tipp");
    expect(stringsFor("xx").tipLabel).toBe(stringsFor("en").tipLabel);
  });
});

describe("heading template", () => {
  const now = new Date(2026, 10, 3, 21, 5);
  it("titles the default heading in the banter's language", () => {
    expect(DEFAULT_SETTINGS.headingTemplate).toBe(DEFAULT_HEADING_TEMPLATE);
    expect(renderHeading(DEFAULT_HEADING_TEMPLATE, now, undefined, "es")).toBe("## 😇😈 Ángel y Demonio (2026-11-03 21:05)");
    expect(renderHeading(DEFAULT_HEADING_TEMPLATE, now, undefined, "ja")).toBe("## 😇😈 天使と悪魔 (2026-11-03 21:05)");
  });
  it("replaces earlier fixed-title defaults but keeps a customized or empty heading", () => {
    for (const legacy of ["## 😇😈 天使と悪魔 ({{date}} {{time}})", "## 😇😈 Angel & Devil ({{date}} {{time}})"]) {
      expect(LEGACY_HEADING_TEMPLATES).toContain(legacy);
      expect(mergeSettings({ headingTemplate: legacy }).headingTemplate).toBe(DEFAULT_HEADING_TEMPLATE);
    }
    expect(mergeSettings({ headingTemplate: "## {{date}}" }).headingTemplate).toBe("## {{date}}");
    expect(mergeSettings({ headingTemplate: "" }).headingTemplate).toBe("");
  });
  it("resets an unsupported banter language to auto", () => {
    expect(mergeSettings({ language: "ko" }).language).toBe("auto");
    expect(mergeSettings({ language: "zh-Hant" }).language).toBe("zh-Hant");
  });
});
