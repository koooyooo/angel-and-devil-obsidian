import { describe, expect, it } from "vitest";
import { BLOCK_BEGIN, BLOCK_END, prepareInput, stripFrontmatter, stripSavedBlocks } from "../src/input";

describe("stripFrontmatter", () => {
  it("removes a leading YAML block", () => {
    expect(stripFrontmatter("---\ntitle: x\ntags: [a]\n---\nbody")).toBe("body");
  });
  it("handles CRLF and a BOM", () => {
    expect(stripFrontmatter("﻿---\r\ntitle: x\r\n---\r\nbody")).toBe("body");
  });
  it("leaves notes without frontmatter alone", () => {
    expect(stripFrontmatter("# Title\n---\nnot frontmatter")).toBe("# Title\n---\nnot frontmatter");
  });
});

describe("stripSavedBlocks", () => {
  const block = (s: string) => `${BLOCK_BEGIN}\n${s}\n${BLOCK_END}`;
  it("removes one saved block", () => {
    expect(stripSavedBlocks(`before\n${block("> 😇 hi")}\nafter`)).toBe("before\n\nafter");
  });
  it("removes several blocks", () => {
    expect(stripSavedBlocks(`a${block("1")}b${block("2")}c`)).toBe("abc");
  });
  it("drops everything after an unclosed block", () => {
    expect(stripSavedBlocks(`keep\n${BLOCK_BEGIN}\n> 😈 left over`)).toBe("keep\n");
  });
});

describe("prepareInput", () => {
  const opts = { fromSelection: false, maxChars: 50 };
  it("rejects very short notes", () => {
    expect(prepareInput("---\na: 1\n---\nhi", opts)).toEqual({ ok: false, reason: "too_short" });
  });
  it("truncates long notes from the start", () => {
    const res = prepareInput("x".repeat(80), opts);
    expect(res).toEqual({ ok: true, text: "x".repeat(50), truncated: true });
  });
  it("keeps a selection's leading --- as content", () => {
    const res = prepareInput("---\nselected text here\n---\nmore", { fromSelection: true, maxChars: 500 });
    expect(res.ok && res.text.startsWith("---")).toBe(true);
  });
  it("strips frontmatter and saved blocks before measuring", () => {
    const raw = `---\nt: 1\n---\nToday I wrote tests.\n${BLOCK_BEGIN}\n> old banter\n${BLOCK_END}\n`;
    expect(prepareInput(raw, { fromSelection: false, maxChars: 500 })).toEqual({
      ok: true,
      text: "Today I wrote tests.",
      truncated: false,
    });
  });
});
