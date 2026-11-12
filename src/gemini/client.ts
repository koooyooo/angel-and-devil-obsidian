import { requestUrl } from "obsidian";
import { GeminiError, extractText, mapHttpError } from "./errors";

const BASE = "https://generativelanguage.googleapis.com/v1beta";
export const REQUEST_TIMEOUT_MS = 60_000;
/** Audio generation is slower than text. */
export const TTS_TIMEOUT_MS = 180_000;

/**
 * Thin wrapper around Obsidian's requestUrl (design doc §5.5).
 * requestUrl avoids CORS and works on mobile; the key goes in a header, never in the URL.
 */
export class GeminiClient {
  constructor(private readonly getApiKey: () => string) {}

  async generateContent(model: string, body: unknown, timeoutMs = REQUEST_TIMEOUT_MS): Promise<unknown> {
    return this.request("POST", `/models/${encodeURIComponent(model)}:generateContent`, body, timeoutMs);
  }

  async generateText(model: string, body: unknown): Promise<string> {
    return extractText(await this.generateContent(model, body));
  }

  /** Used by the settings tab to check that the key works. */
  async listModels(): Promise<void> {
    await this.request("GET", "/models?pageSize=1");
  }

  private async request(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
    timeoutMs = REQUEST_TIMEOUT_MS,
  ): Promise<unknown> {
    const apiKey = this.getApiKey().trim();
    if (!apiKey) throw new GeminiError("invalid_key");

    const call = requestUrl({
      url: `${BASE}${path}`,
      method,
      headers: { "x-goog-api-key": apiKey },
      contentType: body === undefined ? undefined : "application/json",
      body: body === undefined ? undefined : JSON.stringify(body),
      throw: false,
    }).then(
      (res) => {
        let json: unknown;
        try {
          json = res.json;
        } catch {
          json = undefined;
        }
        if (res.status >= 400) throw mapHttpError(res.status, json);
        return json;
      },
      () => {
        throw new GeminiError("network");
      },
    );

    // requestUrl has no timeout or abort; stop waiting after the limit (design doc §5.5).
    let timer: number | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = window.setTimeout(() => reject(new GeminiError("timeout")), timeoutMs);
    });
    try {
      return await Promise.race([call, timeout]);
    } finally {
      window.clearTimeout(timer);
    }
  }
}
