import { describe, expect, it } from "vitest";
import { normalizeVaultPath } from "../src/path";

describe("normalizeVaultPath", () => {
  it.each([
    ["Angel and Devil", "Angel and Devil"],
    ["Angel and Devil/history.md", "Angel and Devil/history.md"],
    ["/Angel and Devil/", "Angel and Devil"],
    ["a//b///c.md", "a/b/c.md"],
    ["a\\b\\c.md", "a/b/c.md"],
    ["a\\/b", "a/b"],
    ["", "/"],
    ["///", "/"],
    ["a b c", "a b c"],
  ])("normalizes %j to %j", (input, expected) => {
    expect(normalizeVaultPath(input)).toBe(expected);
  });
  it("composes accents to NFC", () => {
    const decomposed = "Café/note.md";
    expect(normalizeVaultPath(decomposed)).toBe("Café/note.md");
  });
});
