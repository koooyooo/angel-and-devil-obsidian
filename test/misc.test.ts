import { describe, expect, it } from "vitest";
import { detectLanguage } from "../src/lang";
import { revealDelay, scrollTopToReveal } from "../src/ui/bubbles";

describe("revealDelay", () => {
  it("clamps to the 1.2s–5s range", () => {
    expect(revealDelay(0, "normal")).toBe(1200);
    expect(revealDelay(1000, "normal")).toBe(5000);
    expect(revealDelay(40, "normal")).toBe(2000);
  });
  it("applies the speed factor", () => {
    expect(revealDelay(40, "slow")).toBe(3000);
    expect(revealDelay(40, "fast")).toBe(1200);
  });
});

describe("scrollTopToReveal", () => {
  const base = { scrollTop: 100, viewHeight: 400, paddingTop: 18, paddingBottom: 18 };
  it("scrolls down far enough to include the padding below the item", () => {
    expect(scrollTopToReveal({ ...base, itemTop: 400, itemBottom: 600 })).toBe(218);
  });
  it("scrolls up to include the padding above the item", () => {
    expect(scrollTopToReveal({ ...base, itemTop: 60, itemBottom: 200 })).toBe(42);
  });
  it("never goes above the start of the content", () => {
    expect(scrollTopToReveal({ ...base, itemTop: 10, itemBottom: 200 })).toBe(0);
  });
  it("stays put when the item and its padding are already visible", () => {
    expect(scrollTopToReveal({ ...base, itemTop: 200, itemBottom: 400 })).toBe(100);
  });
});

describe("detectLanguage", () => {
  it("detects kana and kanji as Japanese", () => {
    expect(detectLanguage("今日はテスト")).toBe("ja");
    expect(detectLanguage("Plain English note")).toBe("en");
  });
});
