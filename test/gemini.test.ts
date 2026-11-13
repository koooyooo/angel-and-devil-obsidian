import { describe, expect, it, vi } from "vitest";
import type { GeminiClient } from "../src/gemini/client";
import { GeminiError, extractText, mapHttpError } from "../src/gemini/errors";
import {
  DialogueGenerator,
  THINKING_BUDGET_25,
  buildRequest,
  buildUserMessage,
  thinkingConfigFor,
} from "../src/gemini/generator";

describe("mapHttpError", () => {
  it.each([
    [400, { error: { details: [{ reason: "API_KEY_INVALID" }] } }, "invalid_key"],
    [400, { error: { message: "API key not valid. Please pass a valid API key." } }, "invalid_key"],
    [403, {}, "invalid_key"],
    [404, {}, "model_not_found"],
    [429, {}, "quota"],
    [503, {}, "server"],
    [400, { error: { message: "Invalid JSON payload" } }, "unknown"],
  ])("%i → %s", (status, body, kind) => {
    expect(mapHttpError(status, body).kind).toBe(kind);
  });
});

describe("extractText", () => {
  it("joins text parts and skips thoughts", () => {
    const body = { candidates: [{ content: { parts: [{ text: "think", thought: true }, { text: "{" }, { text: "}" }] } }] };
    expect(extractText(body)).toBe("{}");
  });
  it("reports blocked prompts and safety stops", () => {
    expect(() => extractText({ promptFeedback: { blockReason: "SAFETY" } })).toThrow(GeminiError);
    try {
      extractText({ candidates: [{ finishReason: "SAFETY" }] });
    } catch (e) {
      expect((e as GeminiError).kind).toBe("blocked");
    }
  });
  it("treats an empty answer as bad output", () => {
    try {
      extractText({ candidates: [{ content: { parts: [] } }] });
      expect.unreachable();
    } catch (e) {
      expect((e as GeminiError).kind).toBe("bad_output");
    }
  });
});

describe("buildUserMessage", () => {
  it("detects Japanese and asks for 5 turns with two exchanges", () => {
    const { message, language } = buildUserMessage({ text: "今日は早起きした", language: "auto", rounds: 2, model: "m" });
    expect(language).toBe("ja");
    expect(message).toContain('detected: Japanese, "ja"');
    expect(message).toContain("Turns: exactly 5");
    expect(message).toContain("<note>\n今日は早起きした\n</note>");
  });
  it("honours a fixed language and auto rounds", () => {
    const { message, language } = buildUserMessage({ text: "今日は", language: "en", rounds: "auto", model: "m" });
    expect(language).toBe("en");
    expect(message).toContain('Output language: English ("en")');
    expect(message).toContain("Turns: 5 or 7");
  });
});

describe("buildRequest", () => {
  it("requests JSON with the response schema", () => {
    const { body } = buildRequest({ text: "hello world", language: "auto", rounds: 3, model: "m" });
    const b = body as { generationConfig: { responseMimeType: string; responseSchema: unknown } };
    expect(b.generationConfig.responseMimeType).toBe("application/json");
    expect(b.generationConfig.responseSchema).toBeTruthy();
  });
  it("keeps thinking light: thinkingLevel low for Gemini 3+/latest, a budget for 2.5, nothing for older", () => {
    const cfgFor = (model: string) =>
      (buildRequest({ text: "hello world", language: "auto", rounds: 3, model }).body as any).generationConfig.thinkingConfig;
    expect(cfgFor("gemini-flash-latest")).toEqual({ thinkingLevel: "low" });
    expect(cfgFor("gemini-3-flash-preview")).toEqual({ thinkingLevel: "low" });
    expect(cfgFor("gemini-2.5-flash")).toEqual({ thinkingBudget: THINKING_BUDGET_25 });
    expect(cfgFor("gemini-2.0-flash")).toBeUndefined();
    expect(thinkingConfigFor("gemini-1.5-pro")).toBeUndefined();
  });
});

describe("DialogueGenerator", () => {
  const valid = JSON.stringify({
    language: "en",
    turns: ["angel", "devil", "angel", "devil", "angel"].map((speaker) => ({ speaker, text: `${speaker}!` })),
  });
  const input = { text: "I wrote some tests today.", language: "auto" as const, rounds: 2 as const, model: "m" };

  it("retries a malformed answer once", async () => {
    const generateText = vi.fn().mockResolvedValueOnce("oops").mockResolvedValueOnce(valid);
    const gen = new DialogueGenerator({ generateText } as unknown as GeminiClient);
    expect((await gen.generate(input)).turns).toHaveLength(5);
    expect(generateText).toHaveBeenCalledTimes(2);
  });

  it("gives up with bad_output after the retry", async () => {
    const generateText = vi.fn().mockResolvedValue("oops");
    const gen = new DialogueGenerator({ generateText } as unknown as GeminiClient);
    await expect(gen.generate(input)).rejects.toMatchObject({ kind: "bad_output" });
    expect(generateText).toHaveBeenCalledTimes(2);
  });

  it("does not retry other errors", async () => {
    const generateText = vi.fn().mockRejectedValue(new GeminiError("quota", 429));
    const gen = new DialogueGenerator({ generateText } as unknown as GeminiClient);
    await expect(gen.generate(input)).rejects.toMatchObject({ kind: "quota" });
    expect(generateText).toHaveBeenCalledTimes(1);
  });
});
