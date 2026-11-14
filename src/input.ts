/**
 * InputExtractor (design doc §5.4): turns a note (or a selection) into the text sent to Gemini.
 * Pure functions only, so they can be unit tested without Obsidian.
 */

export const BLOCK_BEGIN = "%% angel-and-devil:begin %%";
export const BLOCK_END = "%% angel-and-devil:end %%";
export const MIN_INPUT_CHARS = 10;

const FRONTMATTER = /^﻿?---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/;

export function stripFrontmatter(text: string): string {
  return text.replace(FRONTMATTER, "");
}

/** Removes previously saved banter blocks so the pair never reacts to their own lines (F-2.3). */
export function stripSavedBlocks(text: string): string {
  let out = "";
  let rest = text;
  for (;;) {
    const begin = rest.indexOf(BLOCK_BEGIN);
    if (begin === -1) return out + rest;
    out += rest.slice(0, begin);
    const end = rest.indexOf(BLOCK_END, begin + BLOCK_BEGIN.length);
    // An unclosed block swallows the rest of the note: it was written by us and is never user content.
    if (end === -1) return out;
    rest = rest.slice(end + BLOCK_END.length);
  }
}

export type PreparedInput =
  | { ok: true; text: string; truncated: boolean }
  | { ok: false; reason: "too_short" };

export interface PrepareOptions {
  /** True when the text came from an editor selection: frontmatter is not stripped then. */
  fromSelection: boolean;
  maxChars: number;
}

export function prepareInput(raw: string, options: PrepareOptions): PreparedInput {
  let text = options.fromSelection ? raw : stripFrontmatter(raw);
  text = stripSavedBlocks(text).trim();
  if (text.length < MIN_INPUT_CHARS) return { ok: false, reason: "too_short" };
  if (text.length > options.maxChars) {
    return { ok: true, text: text.slice(0, options.maxChars), truncated: true };
  }
  return { ok: true, text, truncated: false };
}

/** Longest reply the user can send after a banter (feature: reply, R-4). */
export const REPLY_MAX_CHARS = 200;

/** One line, trimmed, at most REPLY_MAX_CHARS characters. "" means nothing to send. */
export function normalizeReply(raw: string): string {
  return Array.from(raw.replace(/\s+/g, " ").trim()).slice(0, REPLY_MAX_CHARS).join("").trim();
}
