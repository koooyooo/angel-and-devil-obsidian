import { requestUrl } from "obsidian";
import type { HttpClient, HttpRequest, HttpResponse } from "../../ports";

/** requestUrl avoids CORS and works on mobile, unlike fetch (design doc §5.5). */
export const obsidianHttpClient: HttpClient = {
  async request(req: HttpRequest): Promise<HttpResponse> {
    const res = await requestUrl({
      url: req.url,
      method: req.method,
      headers: req.headers,
      contentType: req.contentType,
      body: req.body,
      throw: false,
    });
    return { status: res.status, text: res.text };
  },
};
