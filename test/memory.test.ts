import moment from "moment";
import { describe, expect, it } from "vitest";
import { buildRequest, buildSystemPrompt, buildUserMessage, renderMemoryBlock } from "../src/gemini/generator";
import { buildResponseSchema, parseDialogue } from "../src/gemini/schema";
import { DEFAULT_LINEUP } from "../src/characters";
import {
  DEFAULT_MEMORY_FOLDER,
  MAX_IMPRESSION_CHARS,
  MAX_MEMO_CHARS,
  appendHistoryLine,
  appendMemoEntry,
  dailyNoteRule,
  formatStamp,
  headingAsText,
  isDiaryNote,
  isInFolder,
  isSameNoteSameDay,
  legacyMemoFileName,
  linkTarget,
  memoFileName,
  normalizeMemoryFolder,
  noteKind,
  parseMemo,
  removeMemoEntries,
  toPromptImpression,
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
    const memo = toPromptMemo({ heading: "h", body: `a\n\nb ${"x".repeat(MAX_MEMO_CHARS)}` });
    expect(memo.text.startsWith("a b x")).toBe(true);
    expect(memo.text.length).toBe(MAX_MEMO_CHARS + 1);
  });

  it("keeps an impression's lines but drops blank ones, and caps it", () => {
    const impression = toPromptImpression({ heading: "2026-11-13 19:22 [[2026-11-13]]", body: "- one  \n\n  - two\n" });
    expect(impression).toEqual({ when: "2026-11-13 19:22 2026-11-13", text: "- one\n- two" });
    const long = toPromptImpression({ heading: "h", body: "y".repeat(MAX_IMPRESSION_CHARS + 50) });
    expect(long.text.length).toBe(MAX_IMPRESSION_CHARS + 1);
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
    expect(body.generationConfig.responseSchema.properties.memory.required).toEqual([
      "summary",
      "angel",
      "devil",
      "impressions",
    ]);
    expect(buildSystemPrompt(DEFAULT_LINEUP, { memory: true })).toContain("`\"devil\"`: Devil's memo about today");

    const { message } = buildUserMessage(input);
    expect(message).toContain(
      '<memory>\nAngel\'s memos about earlier diary notes (speaker "angel"):\n- [2026-11-11 21:00 2026-11-11] Started running.\n</memory>',
    );
    expect(message).toContain("Note kind: diary");
    expect(message.indexOf("</memory>")).toBeLessThan(message.indexOf("<note>"));
  });

  it("tells the model the note kind and labels the memos by it", () => {
    const memos = { angel: [{ when: "w", text: "Read about Rust ownership." }] };
    const { message } = buildUserMessage({
      text: "Rust の所有権について",
      language: "auto",
      rounds: 2,
      model: "m",
      memory: { kind: "content", memos },
    });
    expect(message).toContain("Note kind: content");
    expect(message).toContain('Angel\'s memos about earlier content notes (speaker "angel"):');
    expect(message).not.toContain("diary notes");
  });

  it("leaves out the note kind when memory is off", () => {
    const { message } = buildUserMessage({ text: "今日は早起きした", language: "auto", rounds: 2, model: "m" });
    expect(message).not.toContain("Note kind");
  });

  it("asks for an impression in two aspects, revising mainly the one today's note speaks to", () => {
    const prompt = buildSystemPrompt(DEFAULT_LINEUP, { memory: true });
    expect(prompt).toContain("`[生活]` / `[思考]`");
    expect(prompt).toContain("`[Life]` / `[Mind]`");
    expect(prompt).toContain("**no colon after the tag**");
    expect(prompt).toContain("Revise mainly the aspect that today's note speaks to");
  });

  it("puts each character's impression before their memos", () => {
    const block = renderMemoryBlock(
      { devil: [{ when: "2026-11-12 21:00 2026-11-12", text: "Promised to study statistics." }] },
      DEFAULT_LINEUP,
      { devil: { when: "2026-11-12 21:00 2026-11-12", text: "- Leaves the task list empty every day: just their format." } },
    );
    expect(block).toBe(
      [
        "<memory>",
        'Devil\'s impression of the user (speaker "devil", as of 2026-11-12 21:00 2026-11-12):',
        "- Leaves the task list empty every day: just their format.",
        "",
        'Devil\'s memos about earlier diary notes (speaker "devil"):',
        "- [2026-11-12 21:00 2026-11-12] Promised to study statistics.",
        "</memory>",
      ].join("\n"),
    );
    expect(renderMemoryBlock({}, DEFAULT_LINEUP, { angel: { when: "w", text: "- kind" } })).toContain("Angel's impression");
  });

  it("tells the model not to repeat points or nitpick the note's format", () => {
    const prompt = buildSystemPrompt(DEFAULT_LINEUP, { memory: true });
    expect(prompt).toContain("already made");
    expect(prompt).toContain("`impressions`");
    expect(prompt).not.toContain("{{");
  });

  it("asks for an inner voice in parentheses that rarely slips out", () => {
    const prompt = buildSystemPrompt(DEFAULT_LINEUP, { memory: true });
    expect(prompt).toContain("**Inner voice**");
    expect(prompt).toContain("wrapped entirely in parentheses: `（…）` in Japanese, `(…)` in English");
    expect(prompt).toContain("Devil's grudging respect");
    expect(prompt).toContain("At most one slip in the whole banter");
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
    expect(parseDialogue(raw, "en")?.memory).toEqual({ summary: "Early start", notes: { angel: "Woke at 5." }, impressions: {} });
  });

  it("reads impressions as tidy lines and skips empty ones", () => {
    const impressions = { angel: "- Keeps promises \n\n-  Ships often", devil: "  ", other: "ignored" };
    const raw = JSON.stringify({ language: "en", turns, memory: { summary: "s", angel: "a", devil: "d", impressions } });
    expect(parseDialogue(raw, "en")?.memory?.impressions).toEqual({ angel: "- Keeps promises\n- Ships often" });
    const bad = JSON.stringify({ language: "en", turns, memory: { summary: "s", angel: "a", devil: "d", impressions: "oops" } });
    expect(parseDialogue(bad, "en")?.memory).toEqual({ summary: "s", notes: { angel: "a", devil: "d" }, impressions: {} });
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
    expect(mergeSettings({ memory: { enabled: true, folder: "Journal/aad" } }).memory).toEqual({
      enabled: true,
      folder: "Journal/aad",
    });
    expect(mergeSettings({ memory: { enabled: true, folder: ".aad" } }).memory.folder).toBe(DEFAULT_MEMORY_FOLDER);
  });
});

describe("dailyNoteRule", () => {
  it("returns null when there is nothing to go by", () => {
    expect(dailyNoteRule(null)).toBeNull();
    expect(dailyNoteRule("x")).toBeNull();
    expect(dailyNoteRule({})).toBeNull();
    expect(dailyNoteRule({ folder: " ", format: "" })).toBeNull();
  });
  it("cleans the folder and fills in Obsidian's default format", () => {
    expect(dailyNoteRule({ folder: "/Journal/Daily/" })).toEqual({ folder: "Journal/Daily", format: "YYYY-MM-DD" });
    expect(dailyNoteRule({ format: "YYYY年MM月DD日" })).toEqual({ folder: "", format: "YYYY年MM月DD日" });
  });
});

describe("isDiaryNote", () => {
  const note = (path: string, frontmatter?: Record<string, unknown>) => ({
    path,
    basename: path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/, ""),
    frontmatter,
  });
  const strict = (text: string, format: string) => moment(text, format, true).isValid();
  const check = (n: ReturnType<typeof note>, daily: { folder: string; format: string } | null = null) =>
    isDiaryNote(n, daily, strict);

  describe("without Daily notes settings", () => {
    it("treats a dated file name as a diary entry, wherever it is", () => {
      expect(check(note("2026-11-12.md"))).toBe(true);
      expect(check(note("Journal/2026/2026-11-12 Thursday.md"))).toBe(true);
      expect(check(note("2026-11-12_work.md"))).toBe(true);
    });
    it("does not treat other names as diary entries", () => {
      expect(check(note("Articles/Rust ownership.md"))).toBe(false);
      expect(check(note("2026-13-01.md"))).toBe(false);
      expect(check(note("2026-11-123.md"))).toBe(false);
      expect(check(note("Notes from 2026-11-12.md"))).toBe(false);
    });
  });

  describe("with Daily notes settings", () => {
    const daily = { folder: "Daily", format: "YYYY-MM-DD" };
    it("needs both the folder and the date format", () => {
      expect(check(note("Daily/2026-11-12.md"), daily)).toBe(true);
      expect(check(note("Daily/Thursday.md"), daily)).toBe(false);
      expect(check(note("Daily/2026-11-12 Thursday.md"), daily)).toBe(false);
      expect(check(note("Archive/2026-11-12.md"), daily)).toBe(false);
      expect(check(note("Daily-old/2026-11-12.md"), daily)).toBe(false);
    });
    it("uses the vault root when the folder is empty, without matching every note there", () => {
      const root = { folder: "", format: "YYYY-MM-DD" };
      expect(check(note("2026-11-12.md"), root)).toBe(true);
      expect(check(note("Ideas.md"), root)).toBe(false);
      expect(check(note("Journal/2026-11-12.md"), root)).toBe(false);
    });
    it("follows a custom format, including subfolders in the format", () => {
      expect(check(note("Daily/2026年11月12日.md"), { folder: "Daily", format: "YYYY年MM月DD日" })).toBe(true);
      const nested = { folder: "Journal", format: "YYYY/MM/YYYY-MM-DD" };
      expect(check(note("Journal/2026/11/2026-11-12.md"), nested)).toBe(true);
      expect(check(note("Journal/2026-11-12.md"), nested)).toBe(false);
    });
  });

  it("lets the frontmatter kind override the other rules", () => {
    const daily = { folder: "Daily", format: "YYYY-MM-DD" };
    expect(check(note("Articles/Rust ownership.md", { "angel-and-devil-kind": "diary" }))).toBe(true);
    expect(check(note("2026-11-12.md", { "angel-and-devil-kind": "content" }))).toBe(false);
    expect(check(note("Daily/2026-11-12.md", { "angel-and-devil-kind": "content" }), daily)).toBe(false);
    expect(check(note("Articles/x.md", { "angel-and-devil-kind": " Diary " }), daily)).toBe(true);
  });
  it("ignores a kind that is not diary or content", () => {
    expect(check(note("2026-11-12.md", { "angel-and-devil-kind": "maybe" }))).toBe(true);
    expect(check(note("Articles/x.md", { "angel-and-devil-kind": true }))).toBe(false);
    expect(check(note("Articles/x.md", null as unknown as Record<string, unknown>))).toBe(false);
  });
  it("gives the note kind for memory", () => {
    expect(noteKind(note("2026-11-12.md"), null, strict)).toBe("diary");
    expect(noteKind(note("Articles/x.md"), null, strict)).toBe("content");
  });
});

describe("memo file names", () => {
  it("keeps diary and content memos apart and knows the old single file", () => {
    expect(memoFileName("angel", "diary")).toBe("angel_memo_diary.md");
    expect(memoFileName("devil", "content")).toBe("devil_memo_content.md");
    expect(legacyMemoFileName("angel")).toBe("angel_memo.md");
  });
});
