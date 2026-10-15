import { describe, expect, it, vi } from "vitest";
import type { D1Like, Env } from "./env";
import { handleRequest } from "./index";

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

const makeEnv = (): Env => ({
  OPENCODE_API_KEY: "zen-secret",
  APP_TOKEN: "app-secret",
  BUDGET: fakeKv(),
  DB: fakeDb(),
  ASSETS: {
    fetch: async () =>
      new Response("shell", { headers: { "content-type": "text/html" } }),
  },
  ALLOWED_MODELS: "deepseek-v4.1-flash",
  DAILY_CHUNK_BUDGET: "200",
});

const authed = (path: string, init: RequestInit = {}) =>
  new Request(`https://app.example${path}`, {
    ...init,
    headers: { Authorization: "Bearer app-secret", ...(init.headers ?? {}) },
  });

describe("router", () => {
  it("rejects missing and wrong tokens with a uniform 401 plus security headers", async () => {
    for (const request of [
      new Request("https://app.example/api/health"),
      new Request("https://app.example/api/health", {
        headers: { Authorization: "Bearer nope" },
      }),
    ]) {
      const response = await handleRequest(request, makeEnv());
      expect(response.status).toBe(401);
      expect(response.headers.get("Content-Security-Policy")).toBeTruthy();
      expect(response.headers.get("Cache-Control")).toBe("no-store");
    }
  });

  it("rejects cross-origin Origin headers on /api/*", async () => {
    const response = await handleRequest(
      authed("/api/health", { headers: { Origin: "https://evil.example" } }),
      makeEnv(),
    );
    expect(response.status).toBe(403);
  });

  it("answers health checks for authorized same-origin requests", async () => {
    const response = await handleRequest(authed("/api/health"), makeEnv());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it("returns 404 for unknown api routes with a valid token", async () => {
    const response = await handleRequest(authed("/api/nope"), makeEnv());
    expect(response.status).toBe(404);
  });

  it("requires auth for /api/tts and rejects bad voices when authorized", async () => {
    const missing = await handleRequest(
      new Request("https://app.example/api/tts", {
        method: "POST",
        body: JSON.stringify({ text: "Hola.", voice: "es-ES-ElviraNeural" }),
      }),
      makeEnv(),
    );
    expect(missing.status).toBe(401);

    const badVoice = await handleRequest(
      authed("/api/tts", {
        method: "POST",
        body: JSON.stringify({ text: "Hola.", voice: "en-US-JennyNeural" }),
      }),
      makeEnv(),
    );
    expect(badVoice.status).toBe(400);
  });

  it("rejects wrong methods on api routes", async () => {
    const response = await handleRequest(
      authed("/api/health", { method: "POST" }),
      makeEnv(),
    );
    expect(response.status).toBe(404);
  });

  it("redirects a first-run share POST without reading the body or touching assets", async () => {
    const env = makeEnv();
    const assetsFetch = vi.spyOn(env.ASSETS, "fetch");
    const response = await handleRequest(
      new Request("https://app.example/share", { method: "POST" }),
      env,
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe("https://app.example/share");
    expect(assetsFetch).not.toHaveBeenCalled();
  });

  it("serves assets with security headers for app routes", async () => {
    const response = await handleRequest(
      new Request("https://app.example/"),
      makeEnv(),
    );
    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("shell");
    expect(response.headers.get("Content-Security-Policy")).toBeTruthy();
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("routes GET /api/thread to the thread handler", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              code: 200,
              thread: [
                {
                  id: "12345678901234567890",
                  text: "hola",
                  author: { id: "a", name: "N", screen_name: "n" },
                  media: {},
                },
              ],
            }),
            { headers: { "content-type": "application/json" } },
          ),
      ),
    );
    try {
      const response = await handleRequest(
        authed(
          `/api/thread?url=${encodeURIComponent("https://x.com/n/status/12345678901234567890")}`,
        ),
        makeEnv(),
      );
      expect(response.status).toBe(200);
      expect((await response.json()).text).toBe("hola");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("rejects POST on /api/thread", async () => {
    const response = await handleRequest(
      authed("/api/thread", { method: "POST" }),
      makeEnv(),
    );
    expect(response.status).toBe(404);
  });
});
