import { describe, expect, it, vi } from "vitest";
import { ApiError, AuthError, createApi, QuotaError } from "./api";

describe("createApi", () => {
  it("fetchRung sends the bearer token and maps the response", async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(new Uint8Array([1, 2, 3]), {
          headers: {
            "content-type": "text/html; charset=utf-8",
            "x-quiosco-kind": "html",
            "x-quiosco-final-url": "https://example.com/final",
          },
        }),
    );
    const api = createApi({
      token: "secret",
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    const result = await api.fetchRung("direct", "https://example.com/a?b=1");

    expect(fetchFn).toHaveBeenCalledWith(
      "/api/fetch?mode=direct&url=https%3A%2F%2Fexample.com%2Fa%3Fb%3D1",
      {
        headers: { Authorization: "Bearer secret" },
        signal: expect.any(AbortSignal),
      },
    );
    expect(result.kind).toBe("html");
    expect(result.finalUrl).toBe("https://example.com/final");
    expect(Array.from(result.bytes)).toEqual([1, 2, 3]);
  });

  it("fetchRung detects markdown kinds", async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response("md", { headers: { "x-quiosco-kind": "markdown" } }),
    );
    const api = createApi({
      token: "t",
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    expect((await api.fetchRung("jina", "https://example.com")).kind).toBe(
      "markdown",
    );
  });

  it("translate posts JSON and returns the text", async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(JSON.stringify({ text: "hola" }), {
          headers: { "content-type": "application/json" },
        }),
    );
    const api = createApi({
      token: "secret",
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    await expect(
      api.translate({ model: "m", system: "s", text: "t" }),
    ).resolves.toBe("hola");

    const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      Authorization: "Bearer secret",
      "Content-Type": "application/json",
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("maps 401/429/other statuses to typed errors", async () => {
    const make = (status: number) =>
      createApi({
        token: "t",
        fetchFn: (async () =>
          new Response("", { status })) as unknown as typeof fetch,
      });
    await expect(
      make(401).fetchRung("direct", "https://e.com"),
    ).rejects.toBeInstanceOf(AuthError);
    await expect(
      make(429).fetchRung("direct", "https://e.com"),
    ).rejects.toBeInstanceOf(QuotaError);
    await expect(
      make(502).fetchRung("direct", "https://e.com"),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it("health resolves true on 200", async () => {
    const fetchFn = vi.fn(
      async () => new Response(JSON.stringify({ ok: true })),
    );
    const api = createApi({
      token: "t",
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    await expect(api.health()).resolves.toBe(true);
  });

  it("streams SSE deltas and returns the full text", async () => {
    const sse = [
      'data: {"choices":[{"delta":{"content":"Hola"}}]}',
      "",
      'data: {"choices":[{"delta":{"content":" mundo"}}]}',
      "",
      "data: [DONE]",
      "",
    ].join("\n");
    const fetchFn = vi.fn(
      async () =>
        new Response(sse, {
          headers: { "content-type": "text/event-stream" },
        }),
    );
    const api = createApi({
      token: "t",
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    const deltas: string[] = [];
    const text = await api.translateStream(
      { model: "m", system: "s", text: "t" },
      undefined,
      (partial) => deltas.push(partial),
    );
    expect(text).toBe("Hola mundo");
    expect(deltas).toEqual(["Hola", "Hola mundo"]);
    const [url] = fetchFn.mock.calls[0] as unknown as [string];
    expect(url).toBe("/api/translate?stream=1");
  });

  it("falls back to a JSON response when the upstream does not stream", async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(JSON.stringify({ text: "hola" }), {
          headers: { "content-type": "application/json" },
        }),
    );
    const api = createApi({
      token: "t",
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    await expect(
      api.translateStream({ model: "m", system: "s", text: "t" }, undefined),
    ).resolves.toBe("hola");
  });

  it("rejects a stream that ends without a completion marker", async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response('data: {"choices":[{"delta":{"content":"Hola"}}]}\n\n', {
          headers: { "content-type": "text/event-stream" },
        }),
    );
    const api = createApi({
      token: "t",
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    await expect(
      api.translateStream({ model: "m", system: "s", text: "t" }, undefined),
    ).rejects.toThrow("stream interrupted");
  });

  it("decide posts JSON and returns answers", async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            answers: { needs_cleanup: { type: "noul", noul: 0.9 } },
          }),
          { headers: { "content-type": "application/json" } },
        ),
    );
    const api = createApi({
      token: "secret",
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    await expect(
      api.decide({
        model: "jev-1.13-free",
        state: "noisy article",
        questions: {
          needs_cleanup: { type: "noul", instructions: "cleanup?" },
        },
      }),
    ).resolves.toEqual({
      answers: { needs_cleanup: { type: "noul", noul: 0.9 } },
    });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("/api/decide");
    expect(init.method).toBe("POST");
  });

  it("posts a sync request and parses the response", async () => {
    const payload = {
      cursor: 7,
      articles: [{ id: "a", updatedAt: 1, deleted: false, data: "{}" }],
      settings: null,
    };
    const response = { cursor: 9, articles: [], settings: null };
    const fetchFn = vi.fn(
      async () =>
        new Response(JSON.stringify(response), {
          headers: { "content-type": "application/json" },
        }),
    );
    const api = createApi({
      token: "t",
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    await expect(api.sync(payload)).resolves.toEqual(response);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("/api/sync");
    expect(JSON.parse(String(init.body))).toEqual(payload);
  });

  it("fetchThread calls /api/thread and parses the response", async () => {
    const body = {
      title: "Hilo",
      author: "Autor (@autor)",
      text: "Uno\n\nDos",
      tweetCount: 2,
      partial: false,
      source: "fxtwitter",
    };
    const fetchFn = vi.fn(
      async () =>
        new Response(JSON.stringify(body), {
          headers: { "content-type": "application/json" },
        }),
    );
    const api = createApi({
      token: "secret",
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    await expect(
      api.fetchThread("https://x.com/u/status/12345678901234567890"),
    ).resolves.toEqual(body);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(
      "/api/thread?url=https%3A%2F%2Fx.com%2Fu%2Fstatus%2F12345678901234567890",
    );
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer secret",
    );
  });

  it("fetchThread maps thread errors to friendly messages", async () => {
    const make = (status: number) =>
      createApi({
        token: "t",
        fetchFn: (async () =>
          new Response("", { status })) as unknown as typeof fetch,
      });
    await expect(
      make(404).fetchThread("https://x.com/u/status/1"),
    ).rejects.toThrow("That post could not be found");
    await expect(
      make(400).fetchThread("https://x.com/u/status/1"),
    ).rejects.toThrow("That doesn't look like a link to a post.");
    await expect(
      make(502).fetchThread("https://x.com/u/status/1"),
    ).rejects.toThrow("Could not fetch the thread right now. Try again.");
    await expect(
      make(401).fetchThread("https://x.com/u/status/1"),
    ).rejects.toBeInstanceOf(AuthError);
  });

  it("fetchThread rejects a malformed body", async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(JSON.stringify({ nope: true }), {
          headers: { "content-type": "application/json" },
        }),
    );
    const api = createApi({
      token: "t",
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    await expect(api.fetchThread("https://x.com/u/status/1")).rejects.toThrow(
      "Could not fetch the thread right now. Try again.",
    );
  });

  it("fetchThread rejects a non-JSON body with the friendly message", async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response("<html>nope</html>", {
          headers: { "content-type": "text/html" },
        }),
    );
    const api = createApi({
      token: "t",
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    await expect(api.fetchThread("https://x.com/u/status/1")).rejects.toThrow(
      "Could not fetch the thread right now. Try again.",
    );
  });
});
