import { DEFAULT_LINEUP, charName } from "../characters";
import { detectLanguage } from "../lang";
import type { PromptMemo } from "../memory";
import memoryRules from "../prompts/memory.md";
import rules from "../prompts/rules.md";
import type { CharacterSpec, Dialogue, Lang, Rounds, SpeakerId } from "../types";
import type { GeminiClient } from "./client";
import { GeminiError } from "./errors";
import { buildResponseSchema, parseDialogue, turnCountFor } from "./schema";

export interface GenerateInput {
  text: string;
  language: "auto" | Lang;
  rounds: Rounds;
  model: string;
  lineup?: readonly [CharacterSpec, CharacterSpec];
  /**
   * Present only when memory is on: the model then also writes today's memos and updated impressions.
   * `memos` holds each character's earlier memos (oldest first) and `impressions` their latest overall
   * impression of the user; both may be empty on the first run.
   */
  memory?: { memos: Record<SpeakerId, PromptMemo[]>; impressions?: Record<SpeakerId, PromptMemo> };
}

const LANGUAGE_NAME: Record<string, string> = { ja: "Japanese", en: "English" };

function renderTemplate(template: string, lineup: readonly [CharacterSpec, CharacterSpec]): string {
  const [lead, counter] = lineup;
  return template
    .split("{{lead.id}}").join(lead.id)
    .split("{{lead.name}}").join(charName(lead, "en"))
    .split("{{lead.emoji}}").join(lead.emoji)
    .split("{{counter.id}}").join(counter.id)
    .split("{{counter.name}}").join(charName(counter, "en"))
    .split("{{counter.emoji}}").join(counter.emoji);
}

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
  const detected = detectLanguage(input.text);
  const language = input.language === "auto" ? detected : input.language;
  const detectedName = LANGUAGE_NAME[detected] ?? detected;
  const langName = LANGUAGE_NAME[language] ?? language;
  const [lead] = input.lineup ?? DEFAULT_LINEUP;
  const leadName = charName(lead, "en");

  const languageLine =
    input.language === "auto"
      ? `Output language: match the note's language (detected: ${detectedName}, "${detected}").`
      : `Output language: ${langName} ("${language}").`;
  const turnsLine =
    input.rounds === "auto"
      ? `Turns: ${turnCountFor(2)} or ${turnCountFor(3)} (2 or 3 exchanges, then the ${leadName}'s closing), whichever fits the note.`
      : `Turns: exactly ${turnCountFor(input.rounds)} (${input.rounds} exchanges, then the ${leadName}'s closing).`;
  const lines = [languageLine, turnsLine, ""];
  const memoryBlock = input.memory
    ? renderMemoryBlock(input.memory.memos, input.lineup ?? DEFAULT_LINEUP, input.memory.impressions)
    : "";
  if (memoryBlock) lines.push(memoryBlock, "");
  lines.push("<note>", input.text, "</note>");
  return { language, message: lines.join("\n") };
}

/**
 * `<memory>` block for the user message, or "" when neither character has a memo or impression yet.
 * Per character: the current impression of the user first (the big picture), then the dated memos.
 */
export function renderMemoryBlock(
  memos: Record<SpeakerId, PromptMemo[]>,
  lineup: readonly [CharacterSpec, CharacterSpec],
  impressions: Record<SpeakerId, PromptMemo> = {},
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
      sections.push(`${name}'s memos (speaker "${c.id}"):`, ...list.map((m) => `- [${m.when}] ${m.text}`), "");
    }
  }
  while (sections.length && sections[sections.length - 1] === "") sections.pop();
  return sections.length ? ["<memory>", ...sections, "</memory>"].join("\n") : "";
}

/** Gemini 2.5 has no thinkingLevel; this budget is its rough equivalent of "low". */
export const THINKING_BUDGET_25 = 1024;

/**
 * Banter needs little reasoning, and a thinking model's default (dynamic/high) thinking is most of the
 * wait. Keep it light but not off: "minimal" risks flattening the characters.
 * - Gemini 3 and later (and the -latest aliases): thinkingLevel "low".
 * - Gemini 2.5: a small thinkingBudget.
 * - Older models (1.x / 2.0) do not think, so nothing is sent.
 */
export function thinkingConfigFor(model: string): Record<string, unknown> | undefined {
  const m = model.toLowerCase();
  if (/gemini-(1\.|2\.0)/.test(m)) return undefined;
  if (/gemini-2\.5/.test(m)) return { thinkingBudget: THINKING_BUDGET_25 };
  return { thinkingLevel: "low" };
}

export function buildRequest(input: GenerateInput): { body: unknown; language: Lang } {
  const lineup = input.lineup ?? DEFAULT_LINEUP;
  const memory = input.memory !== undefined;
  const { message, language } = buildUserMessage(input);
  const thinkingConfig = thinkingConfigFor(input.model);
  return {
    language,
    body: {
      systemInstruction: { parts: [{ text: buildSystemPrompt(lineup, { memory }) }] },
      contents: [{ role: "user", parts: [{ text: message }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: buildResponseSchema([lineup[0].id, lineup[1].id], { memory }),
        temperature: 1.0,
        ...(thinkingConfig && { thinkingConfig }),
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
}
