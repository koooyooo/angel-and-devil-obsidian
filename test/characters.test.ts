import { existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ALL_CHARACTERS, BUILTIN_CHARACTERS, DEFAULT_LINEUP, charName } from "../src/characters";
import { LANGUAGES } from "../src/lang";
import { DEFAULT_SETTINGS } from "../src/settings-model";

const charDir = fileURLToPath(new URL("../src/characters/", import.meta.url));
const dirs = readdirSync(charDir, { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith("_") && !d.name.startsWith("."))
  .map((d) => d.name)
  .sort();

describe("character directories", () => {
  it("registers exactly the directories under src/characters (run scripts/gen-characters.mjs if this fails)", () => {
    expect(ALL_CHARACTERS.map((c) => c.id)).toEqual(dirs);
  });

  it.each(dirs)("%s: has spec.ts, persona.md and avatar.ts, and the directory name is the ID", (dir) => {
    for (const file of ["spec.ts", "persona.md", "avatar.ts"]) expect(existsSync(`${charDir}${dir}/${file}`)).toBe(true);
    expect(BUILTIN_CHARACTERS[dir]?.id).toBe(dir);
  });

  it.each(dirs)("%s: has a persona, a name in every UI language, and TTS defaults", (dir) => {
    const spec = BUILTIN_CHARACTERS[dir]!;
    expect(spec.promptMarkdown.trim().length).toBeGreaterThan(0);
    for (const { code } of LANGUAGES) expect(spec.name[code], `${dir}.name.${code}`).toBeTruthy();
    expect(spec.ttsSpeakerName).toMatch(/^[A-Za-z][A-Za-z0-9]*$/);
    expect(spec.defaultVoice).toBeTruthy();
    expect(spec.defaultStyle).toBeTruthy();
  });

  it("keeps TTS speaker names and emoji unique across characters", () => {
    const tts = ALL_CHARACTERS.map((c) => c.ttsSpeakerName.toLowerCase());
    expect(new Set(tts).size).toBe(tts.length);
    const emoji = ALL_CHARACTERS.map((c) => c.emoji);
    expect(new Set(emoji).size).toBe(emoji.length);
  });

  it("defaults the lineup to angel (lead) and devil (counter)", () => {
    expect(DEFAULT_LINEUP.map((c) => c.id)).toEqual(["angel", "devil"]);
    expect(DEFAULT_SETTINGS.lineup).toEqual(["angel", "devil"]);
  });

  it("fills TTS voice and style defaults for every character", () => {
    for (const c of ALL_CHARACTERS) {
      expect(DEFAULT_SETTINGS.tts.voices[c.id]).toBe(c.defaultVoice);
      expect(DEFAULT_SETTINGS.tts.styles[c.id]).toBe(c.defaultStyle);
    }
  });

  it("localizes names with an English fallback", () => {
    const angel = BUILTIN_CHARACTERS.angel!;
    expect(charName(angel, "ja")).toBe("天使");
    expect(charName(angel, "xx")).toBe("Angel");
  });
});
