import { describe, expect, it, vi } from "vitest";
import type { Env } from "./env";
import { runRung } from "./fetchRung";

const makeEnv = (overrides: Partial<Env> = {}): Env =>
  ({ JINA_API_KEY: undefined, ...overrides }) as Env;

const htmlResponse = (body: string) =>
  new Response(body, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });

describe("jina rung", () => {
  it("requests html mode and reports the html kind", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response("<!DOCTYPE html><html><body><p>hola</p></body></html>"),
    );
    const outcome = await runRung(
      "jina",
      "https://example.com/a?b=1",
      makeEnv(),
      fetchImpl as unknown as typeof fetch,
    );
    const [calledUrl, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(calledUrl).toBe("https://r.jina.ai/https://example.com/a?b=1");
    expect((init.headers as Record<string, string>)["x-respond-with"]).toBe(
      "html",
    );
    expect(outcome.kind).toBe("html");
    expect(new TextDecoder().decode(outcome.bytes)).toContain("hola");
  });

  it("keeps the markdown kind when Jina returns markdown", async () => {
    const fetchImpl = vi.fn(async () => new Response("Markdown Content: hola"));
    const outcome = await runRung(
      "jina",
      "https://example.com/a",
      makeEnv(),
      fetchImpl as unknown as typeof fetch,
    );
    expect(outcome.kind).toBe("markdown");
    expect(new TextDecoder().decode(outcome.bytes)).toContain("hola");
  });

  it("sends the Jina key when configured", async () => {
    const fetchImpl = vi.fn(async () => new Response("ok"));
    await runRung(
      "jina",
      "https://example.com/a",
      makeEnv({ JINA_API_KEY: "jina-secret" }),
      fetchImpl as unknown as typeof fetch,
    );
    const [, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer jina-secret",
    );
  });

  it("rejects invalid targets before any fetch", async () => {
    const fetchImpl = vi.fn();
    await expect(
      runRung(
        "jina",
        "http://127.0.0.1/",
        makeEnv(),
        fetchImpl as unknown as typeof fetch,
      ),
    ).rejects.toThrow("invalid target");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("wayback rung", () => {
  it("resolves the availability API and fetches the id_ snapshot", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            archived_snapshots: {
              closest: {
                available: true,
                url: "http://web.archive.org/web/20260101000000/https://example.com/a",
              },
            },
          }),
          { headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(htmlResponse("<html>snapshot</html>"));
    const outcome = await runRung(
      "wayback",
      "https://example.com/a",
      makeEnv(),
      fetchImpl as unknown as typeof fetch,
    );
    const [snapshotUrl] = fetchImpl.mock.calls[1] as unknown as [string];
    expect(snapshotUrl).toBe(
      "https://web.archive.org/web/20260101000000id_/https://example.com/a",
    );
    expect(new TextDecoder().decode(outcome.bytes)).toContain("snapshot");
  });

  it("fails when there is no snapshot", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ archived_snapshots: {} }), {
          headers: { "content-type": "application/json" },
        }),
    );
    await expect(
      runRung(
        "wayback",
        "https://example.com/a",
        makeEnv(),
        fetchImpl as unknown as typeof fetch,
      ),
    ).rejects.toThrow("no wayback snapshot");
  });
});

describe("archive_ph rung", () => {
  it("follows the /newest redirect to a snapshot", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { Location: "https://archive.ph/AbC123" },
        }),
      )
      .mockResolvedValueOnce(htmlResponse("<html>archived</html>"));
    const outcome = await runRung(
      "archive_ph",
      "https://example.com/a",
      makeEnv(),
      fetchImpl as unknown as typeof fetch,
    );
    expect(outcome.finalUrl).toBe("https://archive.ph/AbC123");
    expect(new TextDecoder().decode(outcome.bytes)).toContain("archived");
  });

  it("fails when /newest does not redirect", async () => {
    const fetchImpl = vi.fn(async () => htmlResponse("no results"));
    await expect(
      runRung(
        "archive_ph",
        "https://example.com/a",
        makeEnv(),
        fetchImpl as unknown as typeof fetch,
      ),
    ).rejects.toThrow("no archive snapshot");
  });
});
