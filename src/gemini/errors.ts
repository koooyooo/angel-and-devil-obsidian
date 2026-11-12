export type GeminiErrorKind =
  | "invalid_key"
  | "model_not_found"
  | "quota"
  | "server"
  | "network"
  | "timeout"
  | "blocked"
  | "bad_output"
  | "unknown";

export class GeminiError extends Error {
  constructor(
    readonly kind: GeminiErrorKind,
    readonly status?: number,
  ) {
    super(`Gemini request failed: ${kind}${status ? ` (${status})` : ""}`);
    this.name = "GeminiError";
  }
}

export function toGeminiError(e: unknown): GeminiError {
  if (e instanceof GeminiError) return e;
  return new GeminiError("network");
}

interface ErrorBody {
  error?: { status?: string; message?: string; details?: Array<{ reason?: string }> };
}

/**
 * Maps an HTTP error response to a kind the UI understands (design doc §5.5).
 * Never includes the response body in the error: it can echo the request.
 */
export function mapHttpError(status: number, body: unknown): GeminiError {
  const err = (body as ErrorBody | undefined)?.error;
  const reasons = (err?.details ?? []).map((d) => d?.reason ?? "");
  const keyInvalid =
    reasons.includes("API_KEY_INVALID") || /api key/i.test(err?.message ?? "");
  if (status === 401 || status === 403 || (status === 400 && keyInvalid)) {
    return new GeminiError("invalid_key", status);
  }
  if (status === 404) return new GeminiError("model_not_found", status);
  if (status === 429) return new GeminiError("quota", status);
  if (status >= 500) return new GeminiError("server", status);
  return new GeminiError("unknown", status);
}

interface GenerateResponse {
  promptFeedback?: { blockReason?: string };
  candidates?: Array<{
    finishReason?: string;
    content?: { parts?: Array<{ text?: string; thought?: boolean }> };
  }>;
}

/** Extracts the answer text from a generateContent response, or throws `blocked`. */
export function extractText(body: unknown): string {
  const res = body as GenerateResponse | undefined;
  if (res?.promptFeedback?.blockReason) throw new GeminiError("blocked");
  const candidate = res?.candidates?.[0];
  if (!candidate) throw new GeminiError("bad_output");
  if (candidate.finishReason === "SAFETY" || candidate.finishReason === "PROHIBITED_CONTENT") {
    throw new GeminiError("blocked");
  }
  const text = (candidate.content?.parts ?? [])
    .filter((p) => !p.thought)
    .map((p) => p.text ?? "")
    .join("");
  if (!text.trim()) throw new GeminiError("bad_output");
  return text;
}
