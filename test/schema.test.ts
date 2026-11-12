import { describe, expect, it } from "vitest";
import { ANGEL_SPEC, DEVIL_SPEC } from "../src/characters";
import { buildResponseSchema, parseDialogue, turnCountFor } from "../src/gemini/schema";
import type { CharacterSpec } from "../src/types";

const A = (text = "angel line") => ({ speaker: "angel", text });
const D = (text = "devil line") => ({ speaker: "devil", text });
const json = (turns: unknown[], language = "en") => JSON.stringify({ language, turns });

describe("parseDialogue", () => {
  it("accepts a valid five-turn banter", () => {
    const d = parseDialogue(json([A(), D(), A(), D(), A()]), "en");
    expect(d?.turns.map((t) => t.speaker)).toEqual(["angel", "devil", "angel", "devil", "angel"]);
    expect(d?.language).toBe("en");
  });

  it("accepts seven turns", () => {
    expect(parseDialogue(json([A(), D(), A(), D(), A(), D(), A()]), "en")?.turns).toHaveLength(7);
  });

  it("returns null for invalid JSON or a missing turns array", () => {
    expect(parseDialogue("not json", "en")).toBeNull();
    expect(parseDialogue(JSON.stringify({ language: "en" }), "en")).toBeNull();
  });

  it("unwraps a ```json fence", () => {
    const fenced = "```json\n" + json([A(), D(), A(), D(), A()]) + "\n```";
    expect(parseDialogue(fenced, "en")?.turns).toHaveLength(5);
  });

  it("strips CLI-style markers and bold from text", () => {
    const d = parseDialogue(json([A("😇 **天使**: すごい！"), D("Devil: **lazy** much?"), A(), D(), A()]), "ja");
    expect(d?.turns[0].text).toBe("すごい！");
    expect(d?.turns[1].text).toBe("lazy much?");
  });

  it("drops a trailing Devil turn (repairable)", () => {
    const d = parseDialogue(json([A(), D(), A(), D(), A(), D()]), "en");
    expect(d?.turns).toHaveLength(5);
    expect(d?.turns[d.turns.length - 1]?.speaker).toBe("angel");
  });

  it("drops a leading Devil turn and merges consecutive speakers", () => {
    const d = parseDialogue(json([D(), A("a1"), A("a2"), D(), A(), D(), A()]), "en");
    expect(d?.turns.map((t) => t.speaker)).toEqual(["angel", "devil", "angel", "devil", "angel"]);
    expect(d?.turns[0].text).toBe("a1\na2");
  });

  it("cuts more than seven turns down to seven, keeping the Angel last", () => {
    const d = parseDialogue(json([A(), D(), A(), D(), A(), D(), A(), D(), A()]), "en");
    expect(d?.turns).toHaveLength(7);
    expect(d?.turns[d.turns.length - 1]?.speaker).toBe("angel");
  });

  it("returns null when too few turns remain", () => {
    expect(parseDialogue(json([A(), D(), A()]), "en")).toBeNull();
    expect(parseDialogue(json([A(), D(""), A(), D(" "), A()]), "en")).toBeNull();
  });

  it("falls back to the detected language", () => {
    expect(parseDialogue(json([A(), D(), A(), D(), A()], "fr"), "ja")?.language).toBe("ja");
  });

  it("supports a custom or reversed lineup where the lead character opens and closes", () => {
    const socrates: CharacterSpec = {
      ...ANGEL_SPEC,
      id: "socrates",
      name: { ja: "ソクラテス", en: "Socrates" },
      ttsSpeakerName: "Socrates",
      emoji: "🏛️",
    };
    const lineup = [socrates, DEVIL_SPEC] as const;
    const S = (text = "socrates line") => ({ speaker: "socrates", text });
    const schema = buildResponseSchema(["socrates", "devil"]);
    expect(schema.properties.turns.items.properties.speaker.enum).toEqual(["socrates", "devil"]);

    const d = parseDialogue(
      json([D("leading devil dropped"), S("🏛️ **ソクラテス**: 問い直そう"), D(), S(), D(), S(), D("trailing dropped")]),
      "ja",
      lineup,
    );
    expect(d?.turns.map((t) => t.speaker)).toEqual(["socrates", "devil", "socrates", "devil", "socrates"]);
    expect(d?.turns[0].text).toBe("問い直そう");
  });
});

describe("turnCountFor", () => {
  it("adds the Angel's closing turn", () => {
    expect(turnCountFor(2)).toBe(5);
    expect(turnCountFor(3)).toBe(7);
  });
});
