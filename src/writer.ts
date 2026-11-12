import { App, TFile } from "obsidian";
import { appendBlock } from "./format";

/** NoteWriter (design doc §5.8). */
export class NoteWriter {
  constructor(private readonly app: App) {}

  /**
   * Appends to the note the banter was generated from (F-5.1), even if another note is active now.
   * Vault.process reads and writes atomically, so concurrent edits are not lost (F-5.4).
   */
  async append(file: TFile, block: string): Promise<"ok" | "not_found"> {
    // A renamed file keeps the same TFile; a deleted one is no longer resolvable.
    if (this.app.vault.getAbstractFileByPath(file.path) !== file) return "not_found";
    await this.app.vault.process(file, (data) => appendBlock(data, block));
    return "ok";
  }
}
