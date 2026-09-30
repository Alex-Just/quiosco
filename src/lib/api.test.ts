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
      { headers: { Authorization: "Bearer secret" } },
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
});
