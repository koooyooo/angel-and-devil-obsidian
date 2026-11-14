import { BUILTIN_CHARACTERS, DEFAULT_LINEUP, charName } from "./characters";
import { stringsFor } from "./i18n";
import { BLOCK_BEGIN, BLOCK_END } from "./input";
import { LANGUAGE_CODES } from "./lang";
import type { CharacterSpec, Dialogue, Lang, Turn } from "./types";

/** `{{title}}` becomes the plugin name in the banter's language when saving. */
export const DEFAULT_HEADING_TEMPLATE = "## 😇😈 {{title}} ({{date}} {{time}})";

/**
 * Earlier defaults with a fixed title: the Japanese one (the default for every UI language at first) and the
 * per-UI-language ones of the development builds. A saved heading equal to one of these was never customized.
 */
export const LEGACY_HEADING_TEMPLATES: readonly string[] = [
  ...new Set(LANGUAGE_CODES.map((code) => `## 😇😈 ${stringsFor(code).pluginName} ({{date}} {{time}})`)),
];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function renderHeading(
  template: string,
  now: Date,
  lineup: readonly [CharacterSpec, CharacterSpec] = DEFAULT_LINEUP,
  lang: Lang = "ja",
): string {
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const [left, right] = lineup;
  return template
    .split("{{date}}").join(date)
    .split("{{time}}").join(time)
    .split("{{title}}").join(stringsFor(lang).pluginName)
    .split("{{left.emoji}}").join(left.emoji)
    .split("{{right.emoji}}").join(right.emoji)
    .split("{{left.name}}").join(charName(left, lang))
    .split("{{right.name}}").join(charName(right, lang));
}

function formatSpeakerLabel(speakerId: string, lang: Lang, lineup: readonly [CharacterSpec, CharacterSpec]): string {
  const spec = lineup.find((c) => c.id === speakerId) ?? BUILTIN_CHARACTERS[speakerId];
  if (!spec) return `**${speakerId}**`;
  return `${spec.emoji} **${charName(spec, lang)}**`;
}

export const USER_EMOJI = "👤";

/** The turns that are spoken: the banter, then the pair's answer to the user's reply (if any). */
export function spokenTurns(dialogue: Dialogue): Turn[] {
  return dialogue.reply ? [...dialogue.turns, ...dialogue.reply.turns] : dialogue.turns;
}

function quoteLines(label: string, text: string): string {
  const lines = text.split(/\r?\n/);
  const first = `> ${label}: ${lines[0]}`;
  const rest = lines.slice(1).map((line) => (line ? `> ${line}` : ">"));
  return [first, ...rest].join("\n");
}

/** Markdown block appended to the note (design doc §5.8). */
export function toMarkdown(
  dialogue: Dialogue,
  headingTemplate: string,
  now: Date,
  lineup: readonly [CharacterSpec, CharacterSpec] = DEFAULT_LINEUP,
): string {
  const turn = (t: Turn) => quoteLines(formatSpeakerLabel(t.speaker, dialogue.language, lineup), t.text);
  const entries = dialogue.turns.map(turn);
  if (dialogue.reply) {
    // Label for the user's reply line (feature: reply, R-9), in the banter's language like the speaker labels.
    const userLabel = `${USER_EMOJI} **${stringsFor(dialogue.language).you}**`;
    entries.push(quoteLines(userLabel, dialogue.reply.text.replace(/\s+/g, " ")), ...dialogue.reply.turns.map(turn));
  }
  const quoted = entries.join("\n>\n");
  const heading = renderHeading(headingTemplate, now, lineup, dialogue.language).trim();
  const parts = [BLOCK_BEGIN];
  if (heading) parts.push(heading, "");
  parts.push(quoted, BLOCK_END);
  return parts.join("\n");
}

/** Appends a block after the existing content with exactly one blank line in between. */
export function appendBlock(existing: string, block: string): string {
  const body = existing.replace(/\s+$/, "");
  return body ? `${body}\n\n${block}\n` : `${block}\n`;
}

/**
 * Replaces the last occurrence of `oldBlock` with `newBlock` (a saved banter updated after the user's reply).
 * Returns null when `oldBlock` is no longer in the note (for example the user edited it).
 */
export function replaceBlock(existing: string, oldBlock: string, newBlock: string): string | null {
  const at = existing.lastIndexOf(oldBlock);
  if (at === -1) return null;
  return existing.slice(0, at) + newBlock + existing.slice(at + oldBlock.length);
}
