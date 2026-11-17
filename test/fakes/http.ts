import type { HttpClient, HttpRequest, HttpResponse } from "../../src/ports";

/** HttpClient that records requests and answers from a handler (a response, a thrown error, or a promise). */
export class FakeHttpClient implements HttpClient {
  readonly requests: HttpRequest[] = [];

  constructor(private readonly handler: (req: HttpRequest) => HttpResponse | Promise<HttpResponse>) {}

  async request(req: HttpRequest): Promise<HttpResponse> {
    this.requests.push(req);
    return this.handler(req);
  }

  static json(status: number, body: unknown): FakeHttpClient {
    return new FakeHttpClient(() => ({ status, text: JSON.stringify(body) }));
  }
}
