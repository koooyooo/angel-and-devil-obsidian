import { DEFAULT_LINEUP, charName } from "../characters";
import { LANGUAGES, detectLanguage, languageName } from "../lang";
import type { NoteKind, PromptMemo } from "../memory";
import memoryRules from "../prompts/memory.md";
import replyRules from "../prompts/reply.md";
import rules from "../prompts/rules.md";
import type { CharacterSpec, Dialogue, DialogueMemory, Lang, Rounds, SpeakerId, Turn } from "../types";
import type { GeminiClient } from "./client";
import { GeminiError } from "./errors";
import { buildReplySchema, buildResponseSchema, parseDialogue, parseReply, turnCountFor } from "./schema";

export interface GenerateInput {
  text: string;
  language: "auto" | Lang;
  rounds: Rounds;
  model: string;
  lineup?: readonly [CharacterSpec, CharacterSpec];
  /**
   * Present only when memory is on: the model then also writes today's memos and updated impressions.
   * `kind` says whether the note is a diary entry or other content; `memos` holds each character's earlier
   * memos about notes of that kind (oldest first) and `impressions` their latest overall impression of the
   * user; both may be empty on the first run.
   */
  memory?: { kind?: NoteKind; memos: Record<SpeakerId, PromptMemo[]>; impressions?: Record<SpeakerId, PromptMemo> };
}

function renderTemplate(template: string, lineup: readonly [CharacterSpec, CharacterSpec]): string {
  const [lead, counter] = lineup;
  return template
    .split("{{lead.id}}").join(lead.id)
    .split("{{lead.name}}").join(charName(lead, "en"))
    .split("{{lead.emoji}}").join(lead.emoji)
    .split("{{counter.id}}").join(counter.id)
    .split("{{counter.name}}").join(charName(counter, "en"))
    .split("{{counter.emoji}}").join(counter.emoji)
    .split("{{languages}}").join(LANGUAGE_LIST);
}

const LANGUAGE_LIST = LANGUAGES.map((l) => `\`"${l.code}"\` (${l.name})`).join(", ");

export function buildSystemPrompt(
  lineup: readonly [CharacterSpec, CharacterSpec] = DEFAULT_LINEUP,
  options: { memory?: boolean } = {},
): string {
  const [lead, counter] = lineup;
  const leadName = charName(lead, "en");
  const counterName = charName(counter, "en");

  const parts = [renderTemplate(rules, lineup)];
  if (options.memory) parts.push(renderTemplate(memoryRules, lineup));
  if (lead.id !== "angel" || counter.id !== "devil") {
    parts.push(
      `Note on pairing: If a persona below mentions "the Angel" or "the Devil", reinterpret those references as directed toward the current partner in this lineup ("${leadName}" and "${counterName}").`,
    );
  }
  parts.push(
    `# Persona: ${leadName} (Lead, speaker: "${lead.id}")`,
    lead.promptMarkdown,
    `# Persona: ${counterName} (Counter, speaker: "${counter.id}")`,
    counter.promptMarkdown,
  );
  return parts.join("\n\n");
}

export const SYSTEM_PROMPT = buildSystemPrompt(DEFAULT_LINEUP);

export function buildUserMessage(input: GenerateInput): { message: string; language: Lang } {
  // In "auto" the model identifies the note's language; the local guess is only a fallback for a bad answer.
  const language = input.language === "auto" ? detectLanguage(input.text) : input.language;
  const [lead] = input.lineup ?? DEFAULT_LINEUP;
  const leadName = charName(lead, "en");

  const languageLine =
    input.language === "auto"
      ? "Output language: the main language of the note. Identify it yourself and report its code in `language`."
      : `Output language: ${languageName(language)} ("${language}").`;
  const turnsLine =
    input.rounds === "auto"
      ? `Turns: ${turnCountFor(2)} or ${turnCountFor(3)} (2 or 3 exchanges, then the ${leadName}'s closing), whichever fits the note.`
      : `Turns: exactly ${turnCountFor(input.rounds)} (${input.rounds} exchanges, then the ${leadName}'s closing).`;
  const lines = [languageLine, turnsLine];
  const kind = input.memory?.kind ?? "diary";
  if (input.memory) lines.push(`Note kind: ${NOTE_KIND_LINE[kind]}`);
  lines.push("");
  const memoryBlock = input.memory
    ? renderMemoryBlock(input.memory.memos, input.lineup ?? DEFAULT_LINEUP, input.memory.impressions, kind)
    : "";
  if (memoryBlock) lines.push(memoryBlock, "");
  lines.push("<note>", input.text, "</note>");
  return { language, message: lines.join("\n") };
}

const NOTE_KIND_LINE: Record<NoteKind, string> = {
  diary: "diary (the user's own daily note)",
  content: "content (not a diary entry: an article, book note, study note, idea, plan, …)",
};

const MEMO_LABEL: Record<NoteKind, string> = {
  diary: "memos about earlier diary notes",
  content: "memos about earlier content notes",
};

/**
 * `<memory>` block for the user message, or "" when neither character has a memo or impression yet.
 * Per character: the overall impression of the user first (the big picture, built from both kinds of notes),
 * then the dated memos about earlier notes of the same `kind` as today's.
 */
export function renderMemoryBlock(
  memos: Record<SpeakerId, PromptMemo[]>,
  lineup: readonly [CharacterSpec, CharacterSpec],
  impressions: Record<SpeakerId, PromptMemo> = {},
  kind: NoteKind = "diary",
): string {
  const sections: string[] = [];
  for (const c of lineup) {
    const name = charName(c, "en");
    const impression = impressions[c.id];
    if (impression?.text) {
      sections.push(`${name}'s impression of the user (speaker "${c.id}", as of ${impression.when}):`, impression.text, "");
    }
    const list = memos[c.id] ?? [];
    if (list.length > 0) {
      sections.push(`${name}'s ${MEMO_LABEL[kind]} (speaker "${c.id}"):`, ...list.map((m) => `- [${m.when}] ${m.text}`), "");
    }
  }
  while (sections.length && sections[sections.length - 1] === "") sections.pop();
  return sections.length ? ["<memory>", ...sections, "</memory>"].join("\n") : "";
}

export function buildRequest(input: GenerateInput): { body: unknown; language: Lang } {
  const lineup = input.lineup ?? DEFAULT_LINEUP;
  const memory = input.memory !== undefined;
  const { message, language } = buildUserMessage(input);
  return {
    language,
    body: {
      systemInstruction: { parts: [{ text: buildSystemPrompt(lineup, { memory }) }] },
      contents: [{ role: "user", parts: [{ text: message }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: buildResponseSchema([lineup[0].id, lineup[1].id], { memory }),
        temperature: 1.0,
      },
    },
  };
}

/** What the user replied to a banter (feature: reply). */
export interface ReplyInput {
  /** Exactly the input the banter was generated from (same memory snapshot), so the prompt prefix matches. */
  base: GenerateInput;
  dialogue: Dialogue;
  /** Already normalized with normalizeReply(). */
  replyText: string;
}

export interface ReplyResult {
  /** [Counter, Lead]. */
  turns: Turn[];
  memory?: DialogueMemory;
}

/** Keeps the user's text from closing the tag it sits in. */
function neutralizeTag(text: string, tag: string): string {
  return text.split(`</${tag}>`).join(`</ ${tag}>`);
}

/**
 * The reply request's user message: the banter's own user message, unchanged, followed by the banter, the
 * user's reply, and the follow-up rules. The system prompt is also the banter's own, so the whole prefix can hit
 * Gemini's implicit cache.
 */
export function buildReplyMessage(input: ReplyInput): string {
  const lineup = input.base.lineup ?? DEFAULT_LINEUP;
  const { message } = buildUserMessage(input.base);
  const label = (speaker: SpeakerId) => {
    const spec = lineup.find((c) => c.id === speaker);
    return spec ? `${charName(spec, "en")} ("${speaker}")` : speaker;
  };
  const banter = input.dialogue.turns.map((turn) => `${label(turn.speaker)}: ${turn.text.replace(/\s+/g, " ")}`);
  const language = input.dialogue.language;
  const langName = languageName(language);
  return [
    message,
    "",
    "<banter>",
    ...banter.map((line) => neutralizeTag(line, "banter")),
    "</banter>",
    "",
    "<user_reply>",
    neutralizeTag(input.replyText, "user_reply"),
    "</user_reply>",
    "",
    renderTemplate(replyRules, lineup).trim(),
    "",
    `Output language for the reply: ${langName} ("${language}"), the same as the banter.`,
  ].join("\n");
}

export function buildReplyRequest(input: ReplyInput): { body: unknown } {
  const lineup = input.base.lineup ?? DEFAULT_LINEUP;
  const memory = input.base.memory !== undefined;
  return {
    body: {
      systemInstruction: { parts: [{ text: buildSystemPrompt(lineup, { memory }) }] },
      contents: [{ role: "user", parts: [{ text: buildReplyMessage(input) }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: buildReplySchema([lineup[0].id, lineup[1].id], { memory }),
        temperature: 1.0,
      },
    },
  };
}

/** DialogueGenerator (design doc §2.2, §5.6): builds the prompt, calls Gemini, validates the result. */
export class DialogueGenerator {
  constructor(private readonly client: GeminiClient) {}

  async generate(input: GenerateInput): Promise<Dialogue> {
    const lineup = input.lineup ?? DEFAULT_LINEUP;
    const { body, language } = buildRequest(input);
    // A malformed answer gets exactly one automatic retry (F-3.7); other errors propagate.
    for (let attempt = 0; attempt < 2; attempt++) {
      const text = await this.client.generateText(input.model, body);
      const dialogue = parseDialogue(text, language, lineup);
      if (dialogue) return dialogue;
    }
    throw new GeminiError("bad_output");
  }

  /** The pair's answer to the user's reply (feature: reply). Same one-retry rule as generate(). */
  async reply(input: ReplyInput): Promise<ReplyResult> {
    const lineup = input.base.lineup ?? DEFAULT_LINEUP;
    const { body } = buildReplyRequest(input);
    for (let attempt = 0; attempt < 2; attempt++) {
      const text = await this.client.generateText(input.base.model, body);
      const result = parseReply(text, lineup);
      if (result) return result;
    }
    throw new GeminiError("bad_output");
  }
}
