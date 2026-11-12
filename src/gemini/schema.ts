import { DEFAULT_LINEUP } from "../characters";
import type { CharacterSpec, Dialogue, DialogueMemory, Lang, SpeakerId, Turn } from "../types";

export const MIN_TURNS = 5;
export const MAX_TURNS = 7;

/**
 * Gemini `responseSchema` (OpenAPI subset), parameterized by the active lineup. With `memory`, the same
 * call also returns a one-line summary for history.md and one memo per character (see src/memory.ts).
 */
export function buildResponseSchema(
  lineupIds: readonly [SpeakerId, SpeakerId] = ["angel", "devil"],
  options: { memory?: boolean } = {},
) {
  const base = {
    type: "OBJECT",
    properties: {
      language: { type: "STRING", enum: ["ja", "en"] },
      turns: {
        type: "ARRAY",
        minItems: MIN_TURNS,
        maxItems: MAX_TURNS,
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
        },
        required: ["summary", lineupIds[0], lineupIds[1]],
        propertyOrdering: ["summary", lineupIds[0], lineupIds[1]],
      },
    },
    required: [...base.required, "memory"],
    propertyOrdering: [...base.propertyOrdering, "memory"],
  };
}

export const RESPONSE_SCHEMA = buildResponseSchema(["angel", "devil"]);

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
export function parseDialogue(
  raw: string,
  fallbackLanguage: Lang,
  lineup: readonly [CharacterSpec, CharacterSpec] = DEFAULT_LINEUP,
): Dialogue | null {
  let data: unknown;
  try {
    data = JSON.parse(stripCodeFence(raw));
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  const obj = data as { language?: unknown; turns?: unknown; memory?: unknown };
  if (!Array.isArray(obj.turns)) return null;

  const language: Lang = obj.language === "ja" || obj.language === "en" ? obj.language : fallbackLanguage;
  const [lead, counter] = lineup;
  const markerRegex = buildMarkerRegex(lineup);

  // 1. Keep well-formed, non-empty turns belonging to the active lineup.
  const cleaned: Turn[] = [];
  for (const t of obj.turns) {
    if (!t || typeof t !== "object") continue;
    const { speaker, text } = t as { speaker?: unknown; text?: unknown };
    if ((speaker !== lead.id && speaker !== counter.id) || typeof text !== "string") continue;
    const body = cleanText(text, markerRegex);
    if (body) cleaned.push({ speaker, text: body });
  }

  // 2. Merge consecutive turns by the same speaker.
  const merged: Turn[] = [];
  for (const t of cleaned) {
    const last = merged[merged.length - 1];
    if (last && last.speaker === t.speaker) last.text = `${last.text}\n${t.text}`;
    else merged.push({ ...t });
  }

  // 3. Lead character opens and closes.
  while (merged.length && merged[0].speaker !== lead.id) merged.shift();
  while (merged.length && merged[merged.length - 1].speaker !== lead.id) merged.pop();

  // 4. Too long: alternating + Lead at both ends means odd length, so cutting at MAX_TURNS keeps Lead last.
  const turns = merged.length > MAX_TURNS ? merged.slice(0, MAX_TURNS) : merged;

  if (turns.length < MIN_TURNS) return null;
  const memory = parseMemory(obj.memory, lineup);
  return memory ? { language, turns, memory } : { language, turns };
}

/** Memory is a bonus: anything malformed is dropped instead of failing the banter. */
function parseMemory(raw: unknown, lineup: readonly [CharacterSpec, CharacterSpec]): DialogueMemory | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const obj = raw as Record<string, unknown>;
  const oneLine = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");
  const summary = oneLine(obj.summary);
  const notes: Record<SpeakerId, string> = {};
  for (const c of lineup) {
    const note = oneLine(obj[c.id]);
    if (note) notes[c.id] = note;
  }
  if (!summary && Object.keys(notes).length === 0) return undefined;
  return { summary, notes };
}

export function turnCountFor(rounds: 2 | 3): number {
  return rounds * 2 + 1;
}
