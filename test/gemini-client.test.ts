import { afterEach, describe, expect, it, vi } from "vitest";
import { GeminiClient, REQUEST_TIMEOUT_MS } from "../src/gemini/client";
import { FakeHttpClient } from "./fakes/http";

const KEY = "test-key-0000000000000000";
const answer = { candidates: [{ content: { parts: [{ text: "hello" }] } }] };

describe("GeminiClient", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("posts JSON with the key in a header, never in the URL", async () => {
    const http = FakeHttpClient.json(200, answer);
    const text = await new GeminiClient(http, () => ` ${KEY} `).generateText("gemini-x", { contents: [] });
    expect(text).toBe("hello");
    const [req] = http.requests;
    expect(req.method).toBe("POST");
    expect(req.url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-x:generateContent");
    expect(req.url).not.toContain(KEY);
    expect(req.headers).toEqual({ "x-goog-api-key": KEY });
    expect(req.contentType).toBe("application/json");
    expect(JSON.parse(req.body ?? "")).toEqual({ contents: [] });
  });

  it("sends no body for listModels", async () => {
    const http = FakeHttpClient.json(200, { models: [] });
    await new GeminiClient(http, () => KEY).listModels();
    expect(http.requests[0]).toMatchObject({ method: "GET", body: undefined, contentType: undefined });
  });

  it("fails as invalid_key without calling out when no key is set", async () => {
    const http = FakeHttpClient.json(200, answer);
    await expect(new GeminiClient(http, () => "  ").listModels()).rejects.toMatchObject({ kind: "invalid_key" });
    expect(http.requests).toHaveLength(0);
  });

  it.each([
    [400, { error: { details: [{ reason: "API_KEY_INVALID" }] } }, "invalid_key"],
    [403, {}, "invalid_key"],
    [404, {}, "model_not_found"],
    [429, {}, "quota"],
    [503, {}, "server"],
    [418, {}, "unknown"],
  ])("maps HTTP %i to %s", async (status, body, kind) => {
    const client = new GeminiClient(FakeHttpClient.json(status, body), () => KEY);
    await expect(client.listModels()).rejects.toMatchObject({ kind });
  });

  it("treats a non-JSON error body as having no details", async () => {
    const http = new FakeHttpClient(() => ({ status: 502, text: "<html>Bad gateway</html>" }));
    await expect(new GeminiClient(http, () => KEY).listModels()).rejects.toMatchObject({ kind: "server" });
  });

  it("reports a failed request as network", async () => {
    const http = new FakeHttpClient(() => {
      throw new Error("offline");
    });
    await expect(new GeminiClient(http, () => KEY).listModels()).rejects.toMatchObject({ kind: "network" });
  });

  it("stops waiting after the timeout", async () => {
    vi.useFakeTimers();
    const http = new FakeHttpClient(() => new Promise(() => {}));
    const pending = new GeminiClient(http, () => KEY).generateContent("gemini-x", {});
    const assertion = expect(pending).rejects.toMatchObject({ kind: "timeout" });
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
    await assertion;
  });
});
