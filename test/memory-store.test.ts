import { describe, expect, it } from "vitest";
import { resolveLineup } from "../src/characters";
import { parseMemo } from "../src/memory";
import { MemoryStore } from "../src/memory-store";
import type { DialogueMemory } from "../src/types";
import { FakeDailyNoteRules, FakeNoteStore } from "./fakes/notes";

const FOLDER = "_angel_and_devil";
const lineup = resolveLineup(["angel", "devil"]);
const morning = new Date(2026, 10, 3, 9, 0);
const evening = new Date(2026, 10, 3, 21, 30);
const nextDay = new Date(2026, 10, 4, 8, 15);

function memory(tag: string): DialogueMemory {
  return {
    summary: `about ${tag}`,
    notes: { angel: `angel memo ${tag}`, devil: `devil memo ${tag}` },
    impressions: { angel: `angel impression ${tag}`, devil: `devil impression ${tag}` },
  };
}

function setup(o: { enabled?: boolean; daily?: unknown } = {}) {
  const notes = new FakeNoteStore();
  const store = new MemoryStore(notes, new FakeDailyNoteRules(o.daily ?? null), () => ({
    enabled: o.enabled ?? true,
    folder: FOLDER,
  }));
  return { notes, store };
}

function entries(notes: FakeNoteStore, name: string) {
  return parseMemo(notes.content(`${FOLDER}/${name}`) ?? "").entries;
}

describe("MemoryStore.useFor", () => {
  it("is off when memory is turned off", async () => {
    const { notes, store } = setup({ enabled: false });
    expect(await store.useFor(notes.add("2026-11-03.md"))).toBeNull();
  });

  it("never uses memory for a note inside the memory folder", async () => {
    const { notes, store } = setup();
    expect(await store.useFor(notes.add(`${FOLDER}/history.md`))).toBeNull();
  });

  it("tells diary notes from other notes by name without Daily notes settings", async () => {
    const { notes, store } = setup();
    expect(await store.useFor(notes.add("2026-11-03 rest.md"))).toEqual({ folder: FOLDER, kind: "diary" });
    expect(await store.useFor(notes.add("Books/Dune.md"))).toEqual({ folder: FOLDER, kind: "content" });
  });

  it("follows the Daily notes folder and format, and the frontmatter kind", async () => {
    const { notes, store } = setup({ daily: { folder: "/Journal/", format: "YYYY/MM-DD" } });
    expect((await store.useFor(notes.add("Journal/2026/11-03.md")))?.kind).toBe("diary");
    expect((await store.useFor(notes.add("2026-11-03.md")))?.kind).toBe("content");
    const tagged = notes.add("Ideas/today.md", "", { "angel-and-devil-kind": "diary" });
    expect((await store.useFor(tagged))?.kind).toBe("diary");
  });
});

describe("MemoryStore.record", () => {
  it("creates the folder and writes history, a memo and an impression per character, linking the note", async () => {
    const { notes, store } = setup();
    const source = notes.add("daily/2026-11-03.md", "Today I rested.");
    const use = (await store.useFor(source))!;
    await store.record(use, source, lineup, memory("one"), morning, "en");

    expect(notes.paths()).toEqual([
      `${FOLDER}/angel_impression.md`,
      `${FOLDER}/angel_memo_diary.md`,
      `${FOLDER}/devil_impression.md`,
      `${FOLDER}/devil_memo_diary.md`,
      `${FOLDER}/history.md`,
      "daily/2026-11-03.md",
    ]);
    expect(notes.content(`${FOLDER}/history.md`)).toContain("- 2026-11-03 09:00 [[2026-11-03]] about one");
    expect(entries(notes, "angel_memo_diary.md")).toEqual([
      { heading: "2026-11-03 09:00 [[2026-11-03]]", body: "angel memo one" },
    ]);
    expect(entries(notes, "devil_impression.md")[0].body).toBe("devil impression one");
    expect(notes.content("daily/2026-11-03.md")).toBe("Today I rested.");
  });

  it("replaces the same note's record on the same day instead of piling up (Again)", async () => {
    const { notes, store } = setup();
    const source = notes.add("2026-11-03.md");
    const use = (await store.useFor(source))!;
    await store.record(use, source, lineup, memory("first"), morning, "en");
    await store.record(use, source, lineup, memory("again"), evening, "en");

    const history = notes.content(`${FOLDER}/history.md`) ?? "";
    expect(history).not.toContain("about first");
    expect(history.match(/^- 2026-11-03/gm)).toHaveLength(1);
    expect(entries(notes, "angel_memo_diary.md").map((e) => e.body)).toEqual(["angel memo again"]);
    expect(entries(notes, "angel_impression.md").map((e) => e.body)).toEqual(["angel impression again"]);
  });

  it("keeps the record of another day and of another note", async () => {
    const { notes, store } = setup();
    const a = notes.add("2026-11-03.md");
    const b = notes.add("2026-11-04.md");
    const use = (await store.useFor(a))!;
    await store.record(use, a, lineup, memory("a"), morning, "en");
    await store.record(use, b, lineup, memory("b"), evening, "en");
    await store.record(use, a, lineup, memory("a2"), nextDay, "en");
    expect(entries(notes, "angel_memo_diary.md").map((e) => e.body)).toEqual([
      "angel memo a",
      "angel memo b",
      "angel memo a2",
    ]);
  });

  it("drops today's memo from the other kind's file when the note's kind changed", async () => {
    const { notes, store } = setup();
    const source = notes.add("2026-11-03.md");
    await store.record({ folder: FOLDER, kind: "diary" }, source, lineup, memory("as diary"), morning, "en");
    await store.record({ folder: FOLDER, kind: "content" }, source, lineup, memory("as content"), evening, "en");
    expect(entries(notes, "angel_memo_diary.md")).toEqual([]);
    expect(entries(notes, "angel_memo_content.md").map((e) => e.body)).toEqual(["angel memo as content"]);
  });

  it("recognizes its own earlier record after the note was renamed", async () => {
    const { notes, store } = setup();
    const source = notes.add("inbox/draft.md");
    const use = (await store.useFor(source))!;
    await store.record(use, source, lineup, memory("before"), morning, "en");
    await notes.rename(source, "inbox/final.md");
    await store.record(use, source, lineup, memory("after"), evening, "en");
    // [[draft]] no longer resolves (the fake does not rewrite links), so the old entry stays: same as Obsidian
    // with link updating off. With it on, Obsidian rewrites the heading and the entry is replaced.
    expect(entries(notes, "angel_memo_content.md").map((e) => e.heading)).toEqual([
      "2026-11-03 09:00 [[draft]]",
      "2026-11-03 21:30 [[final]]",
    ]);
  });
});

describe("MemoryStore.load", () => {
  it("returns other notes' memos and the newest impression, skipping entries about this note", async () => {
    const { notes, store } = setup();
    const a = notes.add("2026-11-03.md");
    const b = notes.add("2026-11-04.md");
    const use = (await store.useFor(a))!;
    await store.record(use, a, lineup, memory("a"), morning, "en");
    await store.record(use, b, lineup, memory("b"), nextDay, "en");

    const loaded = await store.load(use, a, lineup);
    expect(loaded.memos.angel.map((m) => m.text)).toEqual(["angel memo b"]);
    expect(loaded.memos.devil.map((m) => m.text)).toEqual(["devil memo b"]);
    expect(loaded.count).toBe(2);
    // The newest impression was written about b, so it is kept for a.
    expect(loaded.impressions.angel.text).toBe("angel impression b");

    const forB = await store.load(use, b, lineup);
    expect(forB.memos.angel.map((m) => m.text)).toEqual(["angel memo a"]);
    expect(forB.impressions.angel.text).toBe("angel impression a");
  });

  it("is empty before the first banter and creates nothing", async () => {
    const { notes, store } = setup();
    const source = notes.add("2026-11-03.md");
    const loaded = await store.load((await store.useFor(source))!, source, lineup);
    expect(loaded).toEqual({ memos: {}, impressions: {}, count: 0 });
    expect(notes.writes).toEqual([]);
  });

  it("takes over the old one-file memos as the diary memos", async () => {
    const { notes, store } = setup();
    notes.add(`${FOLDER}/angel_memo.md`, "# Angel\n\n## 2026-11-01 10:00 [[old]]\nangel memo old\n");
    const source = notes.add("2026-11-03.md");
    const loaded = await store.load((await store.useFor(source))!, source, lineup);
    expect(notes.content(`${FOLDER}/angel_memo.md`)).toBeUndefined();
    expect(entries(notes, "angel_memo_diary.md").map((e) => e.body)).toEqual(["angel memo old"]);
    expect(loaded.memos.angel.map((m) => m.text)).toEqual(["angel memo old"]);
  });

  it("leaves both files alone when the old and the new memo file both exist", async () => {
    const { notes, store } = setup();
    notes.add(`${FOLDER}/angel_memo.md`, "## 2026-11-01 10:00 [[old]]\nold\n");
    notes.add(`${FOLDER}/angel_memo_diary.md`, "## 2026-11-02 10:00 [[new]]\nnew\n");
    const source = notes.add("2026-11-03.md");
    await store.load((await store.useFor(source))!, source, lineup);
    expect(notes.content(`${FOLDER}/angel_memo.md`)).toContain("old");
    expect(entries(notes, "angel_memo_diary.md").map((e) => e.body)).toEqual(["new"]);
  });
});
