import { DEFAULT_LINEUP } from "../characters";
import { LANGUAGE_CODES, isSupportedLanguage } from "../lang";
import type { CharacterSpec, Dialogue, DialogueMemory, Lang, SpeakerId, Turn } from "../types";

export const MIN_TURNS = 5;
export const MAX_TURNS = 7;

/**
 * Gemini `responseSchema` (OpenAPI subset), parameterized by the active lineup. With `memory`, the same
 * call also returns a one-line summary for history.md, one memo per character, and each character's
 * updated overall impression of the user (see src/memory.ts).
 */
export function buildResponseSchema(
  lineupIds: readonly [SpeakerId, SpeakerId] = ["angel", "devil"],
  options: { memory?: boolean; turns?: { min: number; max: number } } = {},
) {
  const turnRange = options.turns ?? { min: MIN_TURNS, max: MAX_TURNS };
  const base = {
    type: "OBJECT",
    properties: {
      language: { type: "STRING", enum: [...LANGUAGE_CODES] },
      turns: {
        type: "ARRAY",
        minItems: turnRange.min,
        maxItems: turnRange.max,
        items: {
          type: "OBJECT",
          properties: {
            speaker: { type: "STRING", enum: [lineupIds[0], lineupIds[1]] },
            text: { type: "STRING" },
          },
          required: ["speaker", "text"],
          propertyOrdering: ["speaker", "text"],
        },
      },
    },
    required: ["language", "turns"],
    propertyOrdering: ["language", "turns"],
  } as const;
  if (!options.memory) return base;
  return {
    ...base,
    properties: {
      ...base.properties,
      memory: {
        type: "OBJECT",
        properties: {
          summary: { type: "STRING" },
          [lineupIds[0]]: { type: "STRING" },
          [lineupIds[1]]: { type: "STRING" },
          impressions: {
            type: "OBJECT",
            properties: {
              [lineupIds[0]]: { type: "STRING" },
              [lineupIds[1]]: { type: "STRING" },
            },
            required: [lineupIds[0], lineupIds[1]],
            propertyOrdering: [lineupIds[0], lineupIds[1]],
          },
        },
        required: ["summary", lineupIds[0], lineupIds[1], "impressions"],
        propertyOrdering: ["summary", lineupIds[0], lineupIds[1], "impressions"],
      },
    },
    required: [...base.required, "memory"],
    propertyOrdering: [...base.propertyOrdering, "memory"],
  };
}

export const RESPONSE_SCHEMA = buildResponseSchema(["angel", "devil"]);

/** The pair's answer to the user's reply: always Counter, then Lead (feature: reply, R-3). */
export const REPLY_TURNS = 2;

export function buildReplySchema(
  lineupIds: readonly [SpeakerId, SpeakerId] = ["angel", "devil"],
  options: { memory?: boolean } = {},
) {
  return buildResponseSchema(lineupIds, { ...options, turns: { min: REPLY_TURNS, max: REPLY_TURNS } });
}

const BOLD = /\*\*(.+?)\*\*/g;

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildMarkerRegex(lineup: readonly [CharacterSpec, CharacterSpec]): RegExp {
  const emojis = lineup.map((c) => escapeRegex(c.emoji)).filter(Boolean);
  const names = new Set<string>();
  for (const c of lineup) {
    names.add(escapeRegex(c.id));
    if (c.ttsSpeakerName) names.add(escapeRegex(c.ttsSpeakerName));
    for (const n of Object.values(c.name)) {
      if (n) names.add(escapeRegex(n));
    }
  }
  const emojiPart = emojis.length ? `(?:${emojis.join("|")})?\\s*` : "";
  const namePart = `(?:${Array.from(names).join("|")})`;
  return new RegExp(`^\\s*${emojiPart}(?:\\*\\*)?\\s*${namePart}\\s*(?:\\*\\*)?\\s*[:：]\\s*`, "i");
}

function cleanText(text: string, markerRegex: RegExp): string {
  return text.replace(markerRegex, "").replace(BOLD, "$1").trim();
}

function stripCodeFence(text: string): string {
  const m = text.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return m ? m[1] : text;
}

/**
 * Parses and validates the model output (design doc §5.6), repairing what can be repaired:
 * markers in text, empty turns, consecutive turns by the same speaker, a Counter opening or closing,
 * and too many turns. Returns null when the result still cannot be a valid Dialogue.
 */
interface RawOutput {
  language?: unknown;
  turns: unknown[];
  memory?: unknown;
}

function parseRawOutput(raw: string): RawOutput | null {
  let data: unknown;
  try {
    data = JSON.parse(stripCodeFence(raw));
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  const obj = data as { language?: unknown; turns?: unknown; memory?: unknown };
  if (!Array.isArray(obj.turns)) return null;
  return obj as RawOutput;
}

/**
 * Steps shared by the banter and the reply: keep well-formed, non-empty turns belonging to the active lineup
 * (with markers and bold stripped), then merge consecutive turns by the same speaker.
 */
function cleanTurns(rawTurns: unknown[], lineup: readonly [CharacterSpec, CharacterSpec]): Turn[] {
  const [lead, counter] = lineup;
  const markerRegex = buildMarkerRegex(lineup);
  const merged: Turn[] = [];
  for (const t of rawTurns) {
    if (!t || typeof t !== "object") continue;
    const { speaker, text } = t as { speaker?: unknown; text?: unknown };
    if ((speaker !== lead.id && speaker !== counter.id) || typeof text !== "string") continue;
    const body = cleanText(text, markerRegex);
    if (!body) continue;
    const last = merged[merged.length - 1];
    if (last && last.speaker === speaker) last.text = `${last.text}\n${body}`;
    else merged.push({ speaker, text: body });
  }
  return merged;
}

/**
 * Parses and validates the model output (design doc §5.6), repairing what can be repaired:
 * markers in text, empty turns, consecutive turns by the same speaker, a Counter opening or closing,
 * and too many turns. Returns null when the result still cannot be a valid Dialogue.
 */
export function parseDialogue(
  raw: string,
  fallbackLanguage: Lang,
  lineup: readonly [CharacterSpec, CharacterSpec] = DEFAULT_LINEUP,
): Dialogue | null {
  const obj = parseRawOutput(raw);
  if (!obj) return null;
  const language: Lang = isSupportedLanguage(obj.language) ? obj.language : fallbackLanguage;
  const [lead] = lineup;

  // 1–2. Clean and merge.
  const merged = cleanTurns(obj.turns, lineup);

  // 3. Lead character opens and closes.
  while (merged.length && merged[0].speaker !== lead.id) merged.shift();
  while (merged.length && merged[merged.length - 1].speaker !== lead.id) merged.pop();

  // 4. Too long: alternating + Lead at both ends means odd length, so cutting at MAX_TURNS keeps Lead last.
  const turns = merged.length > MAX_TURNS ? merged.slice(0, MAX_TURNS) : merged;

  if (turns.length < MIN_TURNS) return null;
  const memory = parseMemory(obj.memory, lineup);
  return memory ? { language, turns, memory } : { language, turns };
}

/**
 * Parses the pair's answer to the user's reply (feature: reply): exactly [Counter, Lead] after cleaning.
 * Extra turns after the Lead's are dropped; a Lead opening is not repaired (the Lead must have the last word,
 * so the model is asked again instead). Returns null when it is not a valid answer.
 */
export function parseReply(
  raw: string,
  lineup: readonly [CharacterSpec, CharacterSpec] = DEFAULT_LINEUP,
): { turns: Turn[]; memory?: DialogueMemory } | null {
  const obj = parseRawOutput(raw);
  if (!obj) return null;
  const [lead, counter] = lineup;
  const turns = cleanTurns(obj.turns, lineup).slice(0, REPLY_TURNS);
  if (turns.length !== REPLY_TURNS || turns[0].speaker !== counter.id || turns[1].speaker !== lead.id) return null;
  const memory = parseMemory(obj.memory, lineup);
  return memory ? { turns, memory } : { turns };
}

/** Memory is a bonus: anything malformed is dropped instead of failing the banter. */
function parseMemory(raw: unknown, lineup: readonly [CharacterSpec, CharacterSpec]): DialogueMemory | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const obj = raw as Record<string, unknown>;
  const oneLine = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");
  // An impression may be a short list: keep its lines, drop blank ones and stray spaces.
  const lines = (v: unknown) =>
    typeof v === "string"
      ? v
          .split(/\r\n?|\n/)
          .map((l) => l.replace(/\s+/g, " ").trim())
          .filter((l) => l.length > 0)
          .join("\n")
      : "";
  const summary = oneLine(obj.summary);
  const notes: Record<SpeakerId, string> = {};
  const impressions: Record<SpeakerId, string> = {};
  const rawImpressions =
    obj.impressions && typeof obj.impressions === "object" ? (obj.impressions as Record<string, unknown>) : {};
  for (const c of lineup) {
    const note = oneLine(obj[c.id]);
    if (note) notes[c.id] = note;
    const impression = lines(rawImpressions[c.id]);
    if (impression) impressions[c.id] = impression;
  }
  if (!summary && Object.keys(notes).length === 0 && Object.keys(impressions).length === 0) return undefined;
  return { summary, notes, impressions };
}

export function turnCountFor(rounds: 2 | 3): number {
  return rounds * 2 + 1;
}
