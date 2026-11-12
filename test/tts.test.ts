import { describe, expect, it, vi } from "vitest";
import { pcmToWav } from "../src/audio/wav";
import { ANGEL_SPEC, DEVIL_SPEC, resolveLineup } from "../src/characters";
import type { GeminiClient } from "../src/gemini/client";
import { GeminiError } from "../src/gemini/errors";
import {
  TTS_CHUNK_GAP_MS,
  TtsService,
  VOICE_CONSISTENCY_DIRECTIVE,
  buildTtsRequest,
  chunkTurns,
  extractAudio,
  stripMarkup,
} from "../src/gemini/tts";
import { CURRENT_SCHEMA_VERSION, DEFAULT_SETTINGS, mergeSettings } from "../src/settings";

const cfg = DEFAULT_SETTINGS.tts;
const turns = [
  { speaker: "angel" as const, text: "**Great** job!" },
  { speaker: "devil" as const, text: "Lazy\nas usual." },
  { speaker: "angel" as const, text: "Keep going!" },
];
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
const audioResponse = (mimeType: string, bytes: Uint8Array) => ({
  candidates: [{ content: { parts: [{ inlineData: { mimeType, data: b64(bytes) } }] } }],
});

describe("stripMarkup", () => {
  it("matches speak.py's strip_markup", () => {
    expect(stripMarkup("**bold** *it* `code`   spaced")).toBe("bold it code spaced");
  });
});

describe("buildTtsRequest", () => {
  it("metadata shape: one part per turn with speaker and style plus consistency directive", () => {
    const req = buildTtsRequest(turns, cfg, "metadata") as any;
    expect(req.contents[0].parts).toHaveLength(3);
    expect(req.contents[0].parts[0]).toEqual({
      text: "Great job!",
      speechMetadata: {
        speaker: "Angel",
        style: `${cfg.styles.angel}; ${VOICE_CONSISTENCY_DIRECTIVE}`,
      },
    });
    expect(req.generationConfig.responseModalities).toEqual(["AUDIO"]);
    const voices = req.generationConfig.speechConfig.multiSpeakerVoiceConfig.speakerVoiceConfigs;
    expect(voices).toEqual([
      { speaker: "Angel", voiceConfig: { prebuiltVoiceConfig: { voiceName: "Leda" } } },
      { speaker: "Devil", voiceConfig: { prebuiltVoiceConfig: { voiceName: "Puck" } } },
    ]);
  });
  it("transcript shape: a single Angel:/Devil: script with voice consistency instructions", () => {
    const req = buildTtsRequest(turns, cfg, "transcript") as any;
    const text: string = req.contents[0].parts[0].text;
    expect(text).toContain("Angel: Great job!");
    expect(text).toContain("Devil: Lazy as usual.");
    expect(text).toContain("strictly consistent");
  });
});

describe("extractAudio", () => {
  it("decodes inline audio", () => {
    const res = extractAudio(audioResponse("audio/L16;rate=24000", new Uint8Array([1, 2, 3, 4])));
    expect(res.mimeType).toBe("audio/L16;rate=24000");
    expect(Array.from(res.data)).toEqual([1, 2, 3, 4]);
  });
  it("throws bad_output without audio", () => {
    expect(() => extractAudio({ candidates: [{ content: { parts: [{ text: "hi" }] } }] })).toThrow(GeminiError);
  });
});

describe("chunkTurns", () => {
  it("splits into pairs, leaving a shorter last chunk", () => {
    expect(chunkTurns([1, 2, 3, 4, 5])).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunkTurns([1, 2, 3, 4])).toEqual([[1, 2], [3, 4]]);
    expect(chunkTurns([])).toEqual([]);
  });
});

describe("TtsService", () => {
  it("synthesizes two turns per request and joins the PCM with a gap", async () => {
    const generateContent = vi.fn().mockResolvedValue(audioResponse("audio/L16;rate=24000", new Uint8Array(8)));
    const wav = await new TtsService({ generateContent } as unknown as GeminiClient).synthesize(turns, cfg);
    expect(generateContent).toHaveBeenCalledTimes(2);
    const sent = generateContent.mock.calls.map((c) => (c[1] as any).contents[0].parts.map((p: any) => p.text));
    expect(sent).toEqual([["Great job!", "Lazy\nas usual."], ["Keep going!"]]);
    const gapBytes = ((24000 * TTS_CHUNK_GAP_MS) / 1000) * 2;
    expect(wav.length).toBe(44 + 8 + gapBytes + 8);
    expect(new DataView(wav.buffer).getUint32(24, true)).toBe(24000);
  });

  it("accepts WAV chunks and strips their headers before joining", async () => {
    const generateContent = vi.fn().mockResolvedValue(audioResponse("audio/wav", pcmToWav(new Uint8Array(4), 24000)));
    const wav = await new TtsService({ generateContent } as unknown as GeminiClient).synthesize(turns.slice(0, 2), cfg);
    expect(wav.length).toBe(44 + 4);
  });

  it("falls back to the transcript shape when the API rejects metadata, and remembers it", async () => {
    const ok = audioResponse("audio/wav", pcmToWav(new Uint8Array(2), 24000));
    const generateContent = vi
      .fn()
      .mockRejectedValueOnce(new GeminiError("unknown", 400))
      .mockResolvedValue(ok);
    const tts = new TtsService({ generateContent } as unknown as GeminiClient);
    await tts.synthesize(turns, cfg);
    await tts.synthesize(turns, cfg);
    const shapes = generateContent.mock.calls.map((c) => ("speechMetadata" in (c[1] as any).contents[0].parts[0] ? "metadata" : "transcript"));
    // 1st call: chunk 1 rejected → retried as transcript, chunk 2 transcript; 2nd call: transcript for both chunks.
    expect(shapes).toEqual(["metadata", "transcript", "transcript", "transcript", "transcript"]);
  });

  it("does not fall back on other errors", async () => {
    const generateContent = vi.fn().mockRejectedValue(new GeminiError("quota", 429));
    await expect(new TtsService({ generateContent } as unknown as GeminiClient).synthesize(turns, cfg)).rejects.toMatchObject({ kind: "quota" });
    expect(generateContent).toHaveBeenCalledTimes(1);
  });
});

describe("mergeSettings", () => {
  it("fills new nested TTS fields and schemaVersion/vendor/lineup for settings saved before Phase 2/3", () => {
    const merged = mergeSettings({ textModel: "x", tts: { enabled: true, voices: { angel: "Kore" } } });
    expect(merged.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(merged.textVendor).toBe("gemini");
    expect(merged.lineup).toEqual(["angel", "devil"]);
    expect(merged.textModel).toBe("x");
    expect(merged.tts.enabled).toBe(true);
    expect(merged.tts.vendor).toBe("gemini");
    expect(merged.tts.voices).toEqual({ angel: "Kore", devil: "Puck" });
    expect(merged.tts.speed).toEqual({ ja: 1.2, en: 1.1 });
    expect(merged.tts.confirmEveryTime).toBe(true);
  });
  it("falls back to default lineup when saved lineup is invalid or duplicated", () => {
    expect(mergeSettings({ lineup: ["angel", "angel"] }).lineup).toEqual(["angel", "devil"]);
    expect(mergeSettings({ lineup: ["only-one"] }).lineup).toEqual(["angel", "devil"]);
    expect(resolveLineup(["unknown", "devil"])).toEqual([ANGEL_SPEC, DEVIL_SPEC]);
    expect(resolveLineup(["devil", "angel"])).toEqual([DEVIL_SPEC, ANGEL_SPEC]);
  });
  it("does not share nested objects with the defaults", () => {
    const merged = mergeSettings({});
    merged.tts.speed.ja = 2;
    merged.lineup[0] = "custom";
    expect(DEFAULT_SETTINGS.tts.speed.ja).toBe(1.2);
    expect(DEFAULT_SETTINGS.lineup).toEqual(["angel", "devil"]);
  });
});
