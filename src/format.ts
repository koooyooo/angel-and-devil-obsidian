import { BUILTIN_CHARACTERS, DEFAULT_LINEUP, charName } from "./characters";
import { BLOCK_BEGIN, BLOCK_END } from "./input";
import type { CharacterSpec, Dialogue, Lang } from "./types";

export const DEFAULT_HEADING_TEMPLATE = "## 😇😈 天使と悪魔 ({{date}} {{time}})";

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

/** Markdown block appended to the note (design doc §5.8). */
export function toMarkdown(
  dialogue: Dialogue,
  headingTemplate: string,
  now: Date,
  lineup: readonly [CharacterSpec, CharacterSpec] = DEFAULT_LINEUP,
): string {
  const quoted = dialogue.turns
    .map((turn) => {
      const label = formatSpeakerLabel(turn.speaker, dialogue.language, lineup);
      const lines = turn.text.split(/\r?\n/);
      const first = `> ${label}: ${lines[0]}`;
      const rest = lines.slice(1).map((line) => (line ? `> ${line}` : ">"));
      return [first, ...rest].join("\n");
    })
    .join("\n>\n");
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
