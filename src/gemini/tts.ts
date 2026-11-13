import { base64ToBytes, concatPcmToWav, extractPcm, type PcmClip } from "../audio/wav";
import { BUILTIN_CHARACTERS, DEFAULT_LINEUP } from "../characters";
import type { CharacterSpec, SpeakerId, Turn } from "../types";
import { TTS_TIMEOUT_MS, type GeminiClient } from "./client";
import { GeminiError } from "./errors";

export interface TtsConfig {
  model: string;
  voices: Record<SpeakerId, string>;
  styles: Record<SpeakerId, string>;
}

/**
 * Guardrail appended to TTS style prompts so Gemini's autoregressive audio model does not
 * bleed one speaker's pitch/timbre into the next turn or morph voices mid-turn.
 */
export const VOICE_CONSISTENCY_DIRECTIVE =
  "maintain a strictly consistent pitch, register, and vocal timbre for this character across all turns without drifting toward the other speaker";

/**
 * Turns per TTS request. Long multi-speaker requests drift: around the 4th–5th turn the model starts
 * blending the two voices. Synthesizing short chunks (one angel/devil exchange) and joining the PCM
 * keeps every chunk inside the range where the voices stay stable. Same value as speak.py's TTS_CHUNK_TURNS.
 */
export const TTS_CHUNK_TURNS = 2;

/** Silence inserted between chunks so the joins sound like a normal turn switch. */
export const TTS_CHUNK_GAP_MS = 250;

/** Splits turns into consecutive chunks of `size` (the last one may be shorter). */
export function chunkTurns<T>(turns: readonly T[], size = TTS_CHUNK_TURNS): T[][] {
  const n = Math.max(1, Math.floor(size));
  const chunks: T[][] = [];
  for (let i = 0; i < turns.length; i += n) chunks.push(turns.slice(i, i + n));
  return chunks;
}

/** Same clean-up as speak.py's strip_markup: TTS should not read Markdown aloud. */
export function stripMarkup(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/[ \t]+/g, " ")
    .trim();
}

/**
 * Two request shapes:
 * - "metadata": one part per turn with speechMetadata { speaker, style } — the shape speak.py sends
 *   through the Python SDK (REST field names are camelCase; design doc §15 item 2).
 * - "transcript": the documented multi-speaker form, a single "Angel: … / Devil: …" transcript.
 *   Used as a fallback when the API rejects the metadata shape.
 */
export type TtsRequestShape = "metadata" | "transcript";

function resolveSpec(speakerId: SpeakerId, lineup: readonly [CharacterSpec, CharacterSpec]): CharacterSpec | undefined {
  return lineup.find((c) => c.id === speakerId) ?? BUILTIN_CHARACTERS[speakerId];
}

function withConsistencyDirective(style: string): string {
  const trimmed = style.trim();
  if (!trimmed) return VOICE_CONSISTENCY_DIRECTIVE;
  return `${trimmed}; ${VOICE_CONSISTENCY_DIRECTIVE}`;
}

export function buildTtsRequest(
  turns: Turn[],
  cfg: TtsConfig,
  shape: TtsRequestShape,
  lineup: readonly [CharacterSpec, CharacterSpec] = DEFAULT_LINEUP,
): unknown {
  const [lead, counter] = lineup;
  const speakerNameFor = (id: SpeakerId) => resolveSpec(id, lineup)?.ttsSpeakerName ?? id;
  const styleFor = (id: SpeakerId) => cfg.styles[id] ?? resolveSpec(id, lineup)?.defaultStyle ?? "";
  const voiceFor = (id: SpeakerId) => cfg.voices[id] ?? resolveSpec(id, lineup)?.defaultVoice ?? "Leda";

  const parts =
    shape === "metadata"
      ? turns.map((t) => ({
          text: stripMarkup(t.text),
          speechMetadata: {
            speaker: speakerNameFor(t.speaker),
            style: withConsistencyDirective(styleFor(t.speaker)),
          },
        }))
      : [
          {
            text: [
              `Read this conversation aloud. ${lead.ttsSpeakerName}'s voice is ${styleFor(lead.id)}. ${counter.ttsSpeakerName}'s voice is ${styleFor(counter.id)}.`,
              `Keep each speaker's pitch, vocal register, and timbre strictly consistent from the first turn to the last; never let one speaker's pitch or tone bleed into the next speaker after a turn switch, and never change voice mid-turn.`,
              "",
              ...turns.map((t) => `${speakerNameFor(t.speaker)}: ${stripMarkup(t.text).replace(/\s*\n\s*/g, " ")}`),
            ].join("\n"),
          },
        ];
  return {
    contents: [{ role: "user", parts }],
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: {
        multiSpeakerVoiceConfig: {
          speakerVoiceConfigs: lineup.map((spec) => ({
            speaker: spec.ttsSpeakerName,
            voiceConfig: { prebuiltVoiceConfig: { voiceName: voiceFor(spec.id) } },
          })),
        },
      },
    },
  };
}

interface AudioResponse {
  candidates?: Array<{ finishReason?: string; content?: { parts?: Array<{ inlineData?: { mimeType?: string; data?: string } }> } }>;
  promptFeedback?: { blockReason?: string };
}

export function extractAudio(body: unknown): { mimeType?: string; data: Uint8Array } {
  const res = body as AudioResponse | undefined;
  if (res?.promptFeedback?.blockReason) throw new GeminiError("blocked");
  const candidate = res?.candidates?.[0];
  if (candidate?.finishReason === "SAFETY") throw new GeminiError("blocked");
  const inline = candidate?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData;
  if (!inline?.data) throw new GeminiError("bad_output");
  return { mimeType: inline.mimeType, data: base64ToBytes(inline.data) };
}

/**
 * TtsService (design doc §5.9): turns → WAV bytes. Knows nothing about the UI or playback.
 * The dialogue is synthesized in chunks of TTS_CHUNK_TURNS turns (in parallel) and joined into one WAV.
 */
export class TtsService {
  /** Remembered after the first fallback so later calls go straight to the shape that works. */
  private shape: TtsRequestShape = "metadata";

  constructor(private readonly client: GeminiClient) {}

  async synthesize(
    turns: Turn[],
    cfg: TtsConfig,
    lineup: readonly [CharacterSpec, CharacterSpec] = DEFAULT_LINEUP,
  ): Promise<Uint8Array> {
    const chunks = chunkTurns(turns);
    if (chunks.length === 0) throw new GeminiError("bad_output");
    // The first chunk settles the request shape (and its 400 fallback) before the rest go out in parallel.
    const first = await this.synthesizeChunk(chunks[0], cfg, lineup);
    const rest = await Promise.all(chunks.slice(1).map((chunk) => this.synthesizeChunk(chunk, cfg, lineup)));
    return concatPcmToWav([first, ...rest], TTS_CHUNK_GAP_MS);
  }

  private async synthesizeChunk(
    turns: Turn[],
    cfg: TtsConfig,
    lineup: readonly [CharacterSpec, CharacterSpec],
  ): Promise<PcmClip> {
    let body: unknown;
    try {
      body = await this.client.generateContent(cfg.model, buildTtsRequest(turns, cfg, this.shape, lineup), TTS_TIMEOUT_MS);
    } catch (e) {
      const rejectedShape = e instanceof GeminiError && e.kind === "unknown" && e.status === 400;
      if (!rejectedShape || this.shape === "transcript") throw e;
      this.shape = "transcript";
      body = await this.client.generateContent(cfg.model, buildTtsRequest(turns, cfg, this.shape, lineup), TTS_TIMEOUT_MS);
    }
    const audio = extractAudio(body);
    return extractPcm(audio.data, audio.mimeType);
  }
}
