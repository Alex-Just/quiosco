import { describe, expect, it, vi } from "vitest";
import type { Env } from "./env";
import {
  GOOGLEBOT_UA,
  handleFetchRung,
  readBodyWithCap,
  runRung,
} from "./fetchRung";

const env = {} as Env; // direct/googlebot rungs do not need env

const request = (mode: string, url: string) =>
  new Request(
    `https://app.example/api/fetch?mode=${mode}&url=${encodeURIComponent(url)}`,
  );

const htmlResponse = (body: string) =>
  new Response(body, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });

describe("runRung", () => {
  it("fetches with the browser UA for direct", async () => {
    const fetchImpl = vi.fn(async () => htmlResponse("<html>hola</html>"));
    const outcome = await runRung(
      "direct",
      "https://example.com/a",
      env,
      fetchImpl as unknown as typeof fetch,
    );
    const [, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect((init.headers as Record<string, string>)["User-Agent"]).toContain(
      "Chrome/",
    );
    expect(new TextDecoder().decode(outcome.bytes)).toContain("hola");
    expect(outcome.kind).toBe("html");
  });

  it("uses the Googlebot UA for googlebot", async () => {
    const fetchImpl = vi.fn(async () => htmlResponse("ok"));
    await runRung(
      "googlebot",
      "https://example.com/a",
      env,
      fetchImpl as unknown as typeof fetch,
    );
    const [, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect((init.headers as Record<string, string>)["User-Agent"]).toBe(
      GOOGLEBOT_UA,
    );
  });

  it("rejects invalid targets before fetching", async () => {
    const fetchImpl = vi.fn();
    await expect(
      runRung(
        "direct",
        "ftp://example.com",
        env,
        fetchImpl as unknown as typeof fetch,
      ),
    ).rejects.toThrow("invalid target");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("follows redirects and reports the final URL", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { Location: "https://example.com/next" },
        }),
      )
      .mockResolvedValueOnce(htmlResponse("final"));
    const outcome = await runRung(
      "direct",
      "https://example.com/a",
      env,
      fetchImpl as unknown as typeof fetch,
    );
    expect(outcome.finalUrl).toBe("https://example.com/next");
  });

  it("rejects redirects into private addresses", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(null, {
          status: 302,
          headers: { Location: "http://127.0.0.1/secret" },
        }),
    );
    await expect(
      runRung(
        "direct",
        "https://example.com/a",
        env,
        fetchImpl as unknown as typeof fetch,
      ),
    ).rejects.toThrow("invalid hop");
  });

  it("fails after too many redirects", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(null, {
          status: 302,
          headers: { Location: "https://example.com/loop" },
        }),
    );
    await expect(
      runRung(
        "direct",
        "https://example.com/a",
        env,
        fetchImpl as unknown as typeof fetch,
      ),
    ).rejects.toThrow("too many redirects");
  });
});

describe("handleFetchRung", () => {
  it("returns bytes with via/kind/final-url headers", async () => {
    const fetchImpl = vi.fn(async () => htmlResponse("<html>ok</html>"));
    const response = await handleFetchRung(
      request("direct", "https://example.com/a"),
      env,
      fetchImpl as unknown as typeof fetch,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("x-quiosco-via")).toBe("direct");
    expect(response.headers.get("x-quiosco-kind")).toBe("html");
    expect(response.headers.get("x-quiosco-final-url")).toBe(
      "https://example.com/a",
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("maps upstream 403 to a 502 rung failure", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("blocked", { status: 403 }),
    );
    const response = await handleFetchRung(
      request("direct", "https://example.com/a"),
      env,
      fetchImpl as unknown as typeof fetch,
    );
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      error: "rung failed",
      mode: "direct",
    });
  });

  it("replies 502 for unknown modes", async () => {
    const fetchImpl = vi.fn();
    const response = await handleFetchRung(
      request("bogus", "https://example.com/a"),
      env,
      fetchImpl as unknown as typeof fetch,
    );
    expect(response.status).toBe(502);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("readBodyWithCap", () => {
  it("throws when the body exceeds the cap", async () => {
    await expect(
      readBodyWithCap(new Response("x".repeat(2048)), 1024),
    ).rejects.toThrow("too large");
  });

  it("returns the full body under the cap", async () => {
    const bytes = await readBodyWithCap(new Response("hola"), 1024);
    expect(new TextDecoder().decode(bytes)).toBe("hola");
  });
});
