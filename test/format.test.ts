import { describe, expect, it } from "vitest";
import { ANGEL_SPEC, DEVIL_SPEC } from "../src/characters";
import { DEFAULT_HEADING_TEMPLATE, appendBlock, renderHeading, toMarkdown } from "../src/format";
import { BLOCK_BEGIN, BLOCK_END, stripSavedBlocks } from "../src/input";
import type { CharacterSpec, Dialogue } from "../src/types";

const now = new Date(2026, 10, 3, 21, 5);

const socrates: CharacterSpec = {
  ...ANGEL_SPEC,
  id: "socrates",
  name: { ja: "ソクラテス", en: "Socrates" },
  ttsSpeakerName: "Socrates",
  emoji: "🏛️",
};

const ja: Dialogue = {
  language: "ja",
  turns: [
    { speaker: "angel", text: "素敵です！" },
    { speaker: "devil", text: "ケッ。\n二行目だぜ。" },
    { speaker: "angel", text: "応援しています！" },
  ],
};

describe("renderHeading", () => {
  it("fills date and time with zero padding", () => {
    expect(renderHeading(DEFAULT_HEADING_TEMPLATE, now)).toBe("## 😇😈 天使と悪魔 (2026-11-03 21:05)");
  });

  it("fills left and right character placeholders", () => {
    const tpl = "## {{left.emoji}}{{right.emoji}} {{left.name}}と{{right.name}} ({{date}} {{time}})";
    expect(renderHeading(tpl, now, [socrates, DEVIL_SPEC], "ja")).toBe(
      "## 🏛️😈 ソクラテスと悪魔 (2026-11-03 21:05)",
    );
    expect(renderHeading(tpl, now, [socrates, DEVIL_SPEC], "en")).toBe(
      "## 🏛️😈 SocratesとDevil (2026-11-03 21:05)",
    );
  });
});

describe("toMarkdown", () => {
  it("produces the CLI-compatible quote block wrapped in markers", () => {
    expect(toMarkdown(ja, DEFAULT_HEADING_TEMPLATE, now)).toBe(
      [
        BLOCK_BEGIN,
        "## 😇😈 天使と悪魔 (2026-11-03 21:05)",
        "",
        "> 😇 **天使**: 素敵です！",
        ">",
        "> 😈 **悪魔**: ケッ。",
        "> 二行目だぜ。",
        ">",
        "> 😇 **天使**: 応援しています！",
        BLOCK_END,
      ].join("\n"),
    );
  });

  it("uses English labels for English banter and allows no heading", () => {
    const md = toMarkdown({ ...ja, language: "en" }, "", now);
    expect(md.split("\n")[1]).toBe("> 😇 **Angel**: 素敵です！");
    expect(md).toContain("😈 **Devil**");
  });

  it("is removed again by the input extractor", () => {
    const note = appendBlock("My diary entry.", toMarkdown(ja, DEFAULT_HEADING_TEMPLATE, now));
    expect(stripSavedBlocks(note).trim()).toBe("My diary entry.");
  });

  it("formats a custom character lineup dynamically and still strips cleanly", () => {
    const customDialogue: Dialogue = {
      language: "ja",
      turns: [
        { speaker: "socrates", text: "それは本当に知と言えるかね？" },
        { speaker: "devil", text: "めんどくせえじいさんだな！" },
        { speaker: "socrates", text: "対話を続けよう。" },
      ],
    };
    const tpl = "## {{left.emoji}}{{right.emoji}} {{left.name}}と{{right.name}} ({{date}})";
    const md = toMarkdown(customDialogue, tpl, now, [socrates, DEVIL_SPEC]);
    expect(md).toContain("## 🏛️😈 ソクラテスと悪魔 (2026-11-03)");
    expect(md).toContain("> 🏛️ **ソクラテス**: それは本当に知と言えるかね？");
    expect(md).toContain("> 😈 **悪魔**: めんどくせえじいさんだな！");
    const note = appendBlock("日記本文", md);
    expect(stripSavedBlocks(note).trim()).toBe("日記本文");
  });
});

describe("appendBlock", () => {
  it("leaves exactly one blank line before the block", () => {
    expect(appendBlock("body\n\n\n", "BLOCK")).toBe("body\n\nBLOCK\n");
  });
  it("works on an empty note", () => {
    expect(appendBlock("", "BLOCK")).toBe("BLOCK\n");
  });
});
