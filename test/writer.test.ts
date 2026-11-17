import { describe, expect, it } from "vitest";
import { NoteWriter } from "../src/writer";
import { FakeNoteStore } from "./fakes/notes";

const BLOCK = "## 😇😈 Angel & Devil\n\n😇 **Angel**: Hi";
const UPDATED = `${BLOCK}\n\n😈 **Devil**: Bye`;

describe("NoteWriter.append", () => {
  it("adds the block after the note, separated by a blank line", async () => {
    const notes = new FakeNoteStore();
    const note = notes.add("daily/2026-11-03.md", "Today I rested.\n\n");
    expect(await new NoteWriter(notes).append(note, BLOCK)).toBe("ok");
    expect(notes.content("daily/2026-11-03.md")).toBe(`Today I rested.\n\n${BLOCK}\n`);
  });

  it("follows the note when it was renamed while the banter was open", async () => {
    const notes = new FakeNoteStore();
    const note = notes.add("inbox/draft.md", "Draft");
    await notes.rename(note, "notes/final.md");
    expect(await new NoteWriter(notes).append(note, BLOCK)).toBe("ok");
    expect(notes.content("notes/final.md")).toBe(`Draft\n\n${BLOCK}\n`);
    expect(notes.content("inbox/draft.md")).toBeUndefined();
  });

  it("reports a deleted note instead of recreating it", async () => {
    const notes = new FakeNoteStore();
    const note = notes.add("gone.md", "x");
    notes.delete(note);
    expect(await new NoteWriter(notes).append(note, BLOCK)).toBe("not_found");
    expect(notes.paths()).toEqual([]);
  });
});

describe("NoteWriter.replace", () => {
  it("swaps the saved block for its updated version", async () => {
    const notes = new FakeNoteStore();
    const note = notes.add("a.md", `Body\n\n${BLOCK}\n\nAfter`);
    expect(await new NoteWriter(notes).replace(note, BLOCK, UPDATED)).toBe("ok");
    expect(notes.content("a.md")).toBe(`Body\n\n${UPDATED}\n\nAfter`);
  });

  it("appends when the saved block was edited away", async () => {
    const notes = new FakeNoteStore();
    const note = notes.add("a.md", "Body");
    expect(await new NoteWriter(notes).replace(note, BLOCK, UPDATED)).toBe("appended");
    expect(notes.content("a.md")).toBe(`Body\n\n${UPDATED}\n`);
  });

  it("reports a deleted note", async () => {
    const notes = new FakeNoteStore();
    const note = notes.add("a.md", BLOCK);
    notes.delete(note);
    expect(await new NoteWriter(notes).replace(note, BLOCK, UPDATED)).toBe("not_found");
  });
});
