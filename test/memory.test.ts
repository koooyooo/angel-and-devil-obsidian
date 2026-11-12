import { describe, expect, it } from "vitest";
import { buildRequest, buildSystemPrompt, buildUserMessage, renderMemoryBlock } from "../src/gemini/generator";
import { buildResponseSchema, parseDialogue } from "../src/gemini/schema";
import { DEFAULT_LINEUP } from "../src/characters";
import {
  DEFAULT_MEMORY_FOLDER,
  MAX_MEMO_CHARS,
  appendHistoryLine,
  appendMemoEntry,
  formatStamp,
  headingAsText,
  isInFolder,
  isSameNoteSameDay,
  linkTarget,
  normalizeMemoryFolder,
  parseMemo,
  removeMemoEntries,
  toPromptMemo,
} from "../src/memory";
import { mergeSettings } from "../src/settings";

const PREAMBLE = "# 😇 Angel's memos\n\n%% note %%";

describe("normalizeMemoryFolder", () => {
  it("cleans slashes and spaces", () => {
    expect(normalizeMemoryFolder("  /_angel_and_devil/ ")).toBe("_angel_and_devil");
    expect(normalizeMemoryFolder("System\\aad//memory/")).toBe("System/aad/memory");
  });
  it("refuses dot folders, parent references, empty and invalid names", () => {
    expect(normalizeMemoryFolder(".aad")).toBeNull();
    expect(normalizeMemoryFolder("notes/.hidden")).toBeNull();
    expect(normalizeMemoryFolder("../outside")).toBeNull();
    expect(normalizeMemoryFolder(" / ")).toBeNull();
    expect(normalizeMemoryFolder("a:b")).toBeNull();
  });
});

describe("isInFolder", () => {
  it("matches the folder and its children only", () => {
    expect(isInFolder("_angel_and_devil/history.md", "_angel_and_devil")).toBe(true);
    expect(isInFolder("_angel_and_devil_old/x.md", "_angel_and_devil")).toBe(false);
  });
});

describe("formatStamp", () => {
  it("formats local date and time", () => {
    expect(formatStamp(new Date(2026, 10, 2, 7, 5))).toBe("2026-11-02 07:05");
  });
});

describe("memo files", () => {
  it("creates a file with the preamble and the first entry", () => {
    const text = appendMemoEntry(null, { heading: "2026-11-12 14:30 [[2026-11-12]]", body: "Ran 5 km." }, PREAMBLE);
    expect(text).toBe(`${PREAMBLE}\n\n## 2026-11-12 14:30 [[2026-11-12]]\n\nRan 5 km.\n`);
    expect(parseMemo(text).entries).toEqual([{ heading: "2026-11-12 14:30 [[2026-11-12]]", body: "Ran 5 km." }]);
  });

  it("keeps only the newest entries and the user's own preamble", () => {
    let text = appendMemoEntry(null, { heading: "d0", body: "m0" }, PREAMBLE).replace(PREAMBLE, "# My own title");
    for (let i = 1; i < 13; i++) text = appendMemoEntry(text, { heading: `d${i}`, body: `m${i}` }, PREAMBLE, { max: 10 });
    const parsed = parseMemo(text);
    expect(parsed.preamble).toBe("# My own title");
    expect(parsed.entries.map((e) => e.body)).toEqual(["m3", "m4", "m5", "m6", "m7", "m8", "m9", "m10", "m11", "m12"]);
  });

  it("tolerates hand edits: CRLF, multi-line bodies, and emptied entries", () => {
    const parsed = parseMemo("# T\r\n\r\n## a\r\nline 1\r\nline 2\r\n\r\n## b\r\n\r\n## c\r\nlast\r\n");
    expect(parsed.entries).toEqual([
      { heading: "a", body: "line 1\nline 2" },
      { heading: "c", body: "last" },
    ]);
  });
});

describe("history.md", () => {
  it("starts with the preamble and keeps the list tight", () => {
    let text = appendHistoryLine(null, "- 2026-11-11 21:00 [[a]] one", "# History\n\n%% n %%");
    text = appendHistoryLine(text, "- 2026-11-12 21:00 [[b]] two", "unused");
    expect(text).toBe("# History\n\n%% n %%\n\n- 2026-11-11 21:00 [[a]] one\n- 2026-11-12 21:00 [[b]] two\n");
  });
});

describe("same note, same day replaces", () => {
  const isToday = (s: string) => isSameNoteSameDay(s, "2026-11-12", (target) => target === "Daily/2026-11-12");

  it("matches only the same day and the same note", () => {
    expect(isToday("2026-11-12 08:00 [[Daily/2026-11-12]]")).toBe(true);
    expect(isToday("- 2026-11-12 08:00 [[Daily/2026-11-12]] summary")).toBe(true);
    expect(isToday("2026-11-11 08:00 [[Daily/2026-11-12]]")).toBe(false);
    expect(isToday("2026-11-12 08:00 [[Project]]")).toBe(false);
    expect(isToday("2026-11-12 08:00 no link")).toBe(false);
  });

  it("replaces today's memo for the note and keeps the others", () => {
    let text = appendMemoEntry(null, { heading: "2026-11-11 21:00 [[Daily/2026-11-11]]", body: "yesterday" }, PREAMBLE);
    text = appendMemoEntry(text, { heading: "2026-11-12 08:00 [[Daily/2026-11-12]]", body: "first try" }, PREAMBLE, { replaces: isToday });
    text = appendMemoEntry(text, { heading: "2026-11-12 08:01 [[Daily/2026-11-12]]", body: "again" }, PREAMBLE, { replaces: isToday });
    expect(parseMemo(text).entries.map((e) => e.body)).toEqual(["yesterday", "again"]);
  });

  it("replaces today's history line for the note", () => {
    let text = appendHistoryLine(null, "- 2026-11-12 08:00 [[Daily/2026-11-12]] first", "# H", { replaces: isToday });
    text = appendHistoryLine(text, "- 2026-11-12 08:05 [[Project]] other", "# H", { replaces: isToday });
    text = appendHistoryLine(text, "- 2026-11-12 08:10 [[Daily/2026-11-12]] again", "# H", { replaces: isToday });
    expect(text).toBe("# H\n\n- 2026-11-12 08:05 [[Project]] other\n- 2026-11-12 08:10 [[Daily/2026-11-12]] again\n");
  });

  it("removes today's memo when the new banter has none, and leaves untouched files alone", () => {
    const text = appendMemoEntry(null, { heading: "2026-11-12 08:00 [[Daily/2026-11-12]]", body: "first try" }, PREAMBLE);
    expect(parseMemo(removeMemoEntries(text, isToday)).entries).toEqual([]);
    const other = "# hand-written\n\n## 2026-11-10 [[x]]\n\nkeep   spacing\n";
    expect(removeMemoEntries(other, isToday)).toBe(other);
  });
});

describe("links in headings", () => {
  it("finds the link target and renders headings as text", () => {
    expect(linkTarget("2026-11-12 14:30 [[Daily/2026-11-12#Log|today]]")).toBe("Daily/2026-11-12");
    expect(linkTarget("no link")).toBeNull();
    expect(headingAsText("2026-11-12 14:30 [[Daily/2026-11-12]]")).toBe("2026-11-12 14:30 Daily/2026-11-12");
    expect(headingAsText("x [[a|alias]]")).toBe("x alias");
  });

  it("flattens and caps a memo for the prompt", () => {
    const memo = toPromptMemo({ heading: "h", body: `a\n\nb ${"x".repeat(400)}` });
    expect(memo.text.startsWith("a b x")).toBe(true);
    expect(memo.text.length).toBe(MAX_MEMO_CHARS + 1);
  });
});

describe("memory in the request", () => {
  it("leaves the request unchanged while memory is off", () => {
    const { body } = buildRequest({ text: "今日は早起きした", language: "auto", rounds: 2, model: "m" }) as {
      body: { systemInstruction: { parts: { text: string }[] }; generationConfig: { responseSchema: { required: string[] } } };
    };
    expect(body.systemInstruction.parts[0].text).not.toContain("# Memory");
    expect(body.generationConfig.responseSchema.required).toEqual(["language", "turns"]);
  });

  it("asks for memos and sends earlier ones when memory is on", () => {
    const memos = { angel: [{ when: "2026-11-11 21:00 2026-11-11", text: "Started running." }], devil: [] };
    const input = { text: "今日は早起きした", language: "auto" as const, rounds: 2 as const, model: "m", memory: { memos } };
    const { body } = buildRequest(input) as {
      body: { generationConfig: { responseSchema: { required: string[]; properties: { memory: { required: string[] } } } } };
    };
    expect(body.generationConfig.responseSchema.required).toContain("memory");
    expect(body.generationConfig.responseSchema.properties.memory.required).toEqual(["summary", "angel", "devil"]);
    expect(buildSystemPrompt(DEFAULT_LINEUP, { memory: true })).toContain('`"devil"`: what Devil wants to remember');

    const { message } = buildUserMessage(input);
    expect(message).toContain('<memory>\nAngel\'s memos (speaker "angel"):\n- [2026-11-11 21:00 2026-11-11] Started running.\n</memory>');
    expect(message.indexOf("</memory>")).toBeLessThan(message.indexOf("<note>"));
  });

  it("omits the memory block on the first run", () => {
    expect(renderMemoryBlock({}, DEFAULT_LINEUP)).toBe("");
    const { message } = buildUserMessage({ text: "note text here", language: "en", rounds: 2, model: "m", memory: { memos: {} } });
    expect(message).not.toContain("<memory>");
  });
});

describe("parseDialogue with memory", () => {
  const turns = ["angel", "devil", "angel", "devil", "angel"].map((speaker) => ({ speaker, text: "line" }));

  it("reads the summary and memos as single lines", () => {
    const raw = JSON.stringify({ language: "en", turns, memory: { summary: " Early\nstart ", angel: "Woke at 5.", devil: "" } });
    expect(parseDialogue(raw, "en")?.memory).toEqual({ summary: "Early start", notes: { angel: "Woke at 5." } });
  });

  it("keeps the banter when memory is missing or malformed", () => {
    expect(parseDialogue(JSON.stringify({ language: "en", turns, memory: "oops" }), "en")?.memory).toBeUndefined();
    expect(parseDialogue(JSON.stringify({ language: "en", turns }), "en")?.turns).toHaveLength(5);
  });

  it("builds a schema with memory only on request", () => {
    expect("memory" in buildResponseSchema(["angel", "devil"]).properties).toBe(false);
    expect("memory" in buildResponseSchema(["angel", "devil"], { memory: true }).properties).toBe(true);
  });
});

describe("memory settings", () => {
  it("defaults to off with the default folder", () => {
    expect(mergeSettings({}).memory).toEqual({ enabled: false, folder: DEFAULT_MEMORY_FOLDER });
  });
  it("keeps a valid folder and falls back from a dot folder", () => {
    expect(mergeSettings({ memory: { enabled: true, folder: "Journal/aad" } }).memory).toEqual({ enabled: true, folder: "Journal/aad" });
    expect(mergeSettings({ memory: { enabled: true, folder: ".aad" } }).memory.folder).toBe(DEFAULT_MEMORY_FOLDER);
  });
});
