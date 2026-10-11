import { describe, expect, it, vi } from "vitest";
import { handleDecide } from "./decide";
import type { D1Like, Env } from "./env";

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

const fakeDb = (): D1Like => ({
  prepare() {
    throw new Error("DB not used in these tests");
  },
});

const makeEnv = (overrides: Partial<Env> = {}): Env => ({
  OPENCODE_API_KEY: "zen-secret",
  APP_TOKEN: "app-secret",
  BUDGET: fakeKv(),
  DB: fakeDb(),
  ASSETS: { fetch: async () => new Response("shell") },
  ALLOWED_MODELS: "deepseek-v4.1-flash",
  DECISION_MODELS: "jev-1.13-free,jev-1.13",
  DAILY_CHUNK_BUDGET: "200",
  ...overrides,
});

const post = (body: unknown) =>
  new Request("https://app.example/api/decide", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

describe("handleDecide", () => {
  it("proxies System One and returns answers", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            model: "jev-1.13-free",
            answers: { needs_cleanup: { type: "noul", noul: 0.88 } },
          }),
          { headers: { "content-type": "application/json" } },
        ),
    );
    const response = await handleDecide(
      post({
        model: "jev-1.13-free",
        state: "article text with menus and footers",
        questions: {
          needs_cleanup: {
            type: "noul",
            instructions: "needs cleanup?",
          },
        },
      }),
      makeEnv(),
      fetchImpl as unknown as typeof fetch,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      answers: { needs_cleanup: { type: "noul", noul: 0.88 } },
    });
    const [calledUrl, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(calledUrl).toBe("https://opencode.ai/zen/v1/systemone");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer zen-secret",
    );
  });

  it("rejects models outside the decision allowlist", async () => {
    const response = await handleDecide(
      post({
        model: "deepseek-v4.1-flash",
        state: "text",
        questions: { q: { type: "noul", instructions: "x" } },
      }),
      makeEnv(),
    );
    expect(response.status).toBe(400);
  });

  it("rejects invalid bodies", async () => {
    const response = await handleDecide(
      post({ model: "jev-1.13-free" }),
      makeEnv(),
    );
    expect(response.status).toBe(400);
  });
});
