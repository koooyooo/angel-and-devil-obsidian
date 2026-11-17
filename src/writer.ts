import { appendBlock, replaceBlock } from "./format";
import type { NoteRef, NoteStore } from "./ports";

/** NoteWriter (design doc §5.8). */
export class NoteWriter {
  constructor(private readonly notes: NoteStore) {}

  /**
   * Appends to the note the banter was generated from (F-5.1), even if another note is active now.
   * NoteStore.process reads and writes atomically, so concurrent edits are not lost (F-5.4).
   */
  async append(note: NoteRef, block: string): Promise<"ok" | "not_found"> {
    // A renamed note is still the same NoteRef; a deleted one no longer exists.
    if (!this.notes.exists(note)) return "not_found";
    await this.notes.process(note, (data) => appendBlock(data, block));
    return "ok";
  }

  /**
   * Swaps a block saved earlier for its updated version (feature: reply, R-9). If the old block is gone
   * (edited by hand), the new one is appended instead.
   */
  async replace(note: NoteRef, oldBlock: string, newBlock: string): Promise<"ok" | "appended" | "not_found"> {
    if (!this.notes.exists(note)) return "not_found";
    let appended = false;
    await this.notes.process(note, (data) => {
      const replaced = replaceBlock(data, oldBlock, newBlock);
      appended = replaced === null;
      return replaced ?? appendBlock(data, newBlock);
    });
    return appended ? "appended" : "ok";
  }
}
