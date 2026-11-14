import { App, TFile } from "obsidian";
import { appendBlock, replaceBlock } from "./format";

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

  /**
   * Swaps a block saved earlier for its updated version (feature: reply, R-9). If the old block is gone
   * (edited by hand), the new one is appended instead.
   */
  async replace(file: TFile, oldBlock: string, newBlock: string): Promise<"ok" | "appended" | "not_found"> {
    if (this.app.vault.getAbstractFileByPath(file.path) !== file) return "not_found";
    let appended = false;
    await this.app.vault.process(file, (data) => {
      const replaced = replaceBlock(data, oldBlock, newBlock);
      appended = replaced === null;
      return replaced ?? appendBlock(data, newBlock);
    });
    return appended ? "appended" : "ok";
  }
}
