import { describe, expect, it, vi } from "vitest";
import type { Env } from "./env";
import { handleTranslate } from "./translate";

const fakeKv = () => {
  const map = new Map<string, string>();
  return {
    map,
    async get(key: string) {
      return map.get(key) ?? null;
    },
    async put(key: string, value: string) {
      map.set(key, value);
    },
  };
};

const makeEnv = (overrides: Partial<Env> = {}): Env => ({
  OPENCODE_API_KEY: "zen-secret",
  APP_TOKEN: "app-secret",
  BUDGET: fakeKv(),
  ASSETS: { fetch: async () => new Response("shell") },
  ALLOWED_MODELS: "deepseek-v4.1-flash,big-pickle",
  DAILY_CHUNK_BUDGET: "200",
  ...overrides,
});

const post = (body: unknown) =>
  new Request("https://app.example/api/translate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const upstreamOk = (content: string) =>
  new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    headers: { "content-type": "application/json" },
  });

describe("handleTranslate", () => {
  it("uses the responses protocol for responses-only models", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            output: [{ content: [{ type: "output_text", text: "hola" }] }],
          }),
          { headers: { "content-type": "application/json" } },
        ),
    );
    const response = await handleTranslate(
      post({ model: "gpt-6-luna", system: "s", text: "t" }),
      makeEnv({
        ALLOWED_MODELS: "gpt-6-luna",
        RESPONSES_MODELS: "gpt-6-luna",
      }),
      fetchImpl as unknown as typeof fetch,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ text: "hola" });
    const [calledUrl, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(calledUrl).toBe("https://opencode.ai/zen/v1/responses");
    const body = JSON.parse(String(init.body)) as { input?: unknown[] };
    expect(body.input).toHaveLength(2);
  });

  it("translates via the Zen API with the server-side key", async () => {
    const fetchImpl = vi.fn(async () => upstreamOk("hola"));
    const response = await handleTranslate(
      post({ model: "deepseek-v4.1-flash", system: "s", text: "t" }),
      makeEnv(),
      fetchImpl as unknown as typeof fetch,
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ text: "hola" });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://opencode.ai/zen/v1/chat/completions");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer zen-secret",
    );
    const payload = JSON.parse(String(init.body)) as {
      model: string;
      messages: unknown[];
    };
    expect(payload.model).toBe("deepseek-v4.1-flash");
    expect(payload.messages).toHaveLength(2);
  });

  it("rejects models outside the allowlist", async () => {
    const fetchImpl = vi.fn();
    const response = await handleTranslate(
      post({ model: "claude-fable-5", system: "s", text: "t" }),
      makeEnv(),
      fetchImpl as unknown as typeof fetch,
    );
    expect(response.status).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects malformed requests", async () => {
    const fetchImpl = vi.fn();
    const response = await handleTranslate(
      post({ model: "deepseek-v4.1-flash" }),
      makeEnv(),
      fetchImpl as unknown as typeof fetch,
    );
    expect(response.status).toBe(400);
  });

  it("enforces the daily chunk budget with a 429", async () => {
    const env = makeEnv();
    await env.BUDGET.put(
      `budget:${new Date().toISOString().slice(0, 10)}`,
      "200",
    );
    const fetchImpl = vi.fn();
    const response = await handleTranslate(
      post({ model: "deepseek-v4.1-flash", system: "s", text: "t" }),
      env,
      fetchImpl as unknown as typeof fetch,
    );
    expect(response.status).toBe(429);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns a generic 502 without echoing upstream bodies or keys", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response("boom-secret upstream says no", {
          status: 500,
        }),
    );
    const response = await handleTranslate(
      post({ model: "deepseek-v4.1-flash", system: "s", text: "t" }),
      makeEnv(),
      fetchImpl as unknown as typeof fetch,
    );
    expect(response.status).toBe(502);
    const body = await response.text();
    expect(body).toContain("upstream error");
    expect(body).not.toContain("boom-secret");
    expect(body).not.toContain("zen-secret");
  });

  it("rejects oversized bodies with 413", async () => {
    const fetchImpl = vi.fn();
    const response = await handleTranslate(
      post({
        model: "deepseek-v4.1-flash",
        system: "s",
        text: "x".repeat(2 * 1024 * 1024 + 1),
      }),
      makeEnv(),
      fetchImpl as unknown as typeof fetch,
    );
    expect(response.status).toBe(413);
  });
});
