import { describe, expect, it, vi } from "vitest";
import {
  assembleThread,
  handleThread,
  MAX_WALK_HOPS,
  mediaCountOf,
  parseTweetStatusUrl,
  syndicationToken,
} from "./thread";

describe("parseTweetStatusUrl", () => {
  const id = "2110631479294431539";

  it("extracts the id from the URL shapes X actually shares", () => {
    const urls = [
      `https://x.com/RusiaSeMueve/status/${id}`,
      `https://www.x.com/RusiaSeMueve/status/${id}`,
      `https://mobile.x.com/RusiaSeMueve/status/${id}`,
      `https://m.x.com/RusiaSeMueve/status/${id}`,
      `https://twitter.com/RusiaSeMueve/status/${id}`,
      `https://www.twitter.com/RusiaSeMueve/status/${id}`,
      `https://mobile.twitter.com/RusiaSeMueve/status/${id}`,
      `https://m.twitter.com/RusiaSeMueve/status/${id}`,
      `https://x.com/i/status/${id}`,
      `https://x.com/i/web/status/${id}`,
      `https://x.com/statuses/${id}`,
      `https://x.com/u/status/${id}?s=46&t=abc`,
      `https://x.com/u/status/${id}/photo/1`,
      `https://x.com/u/status/${id}/`,
    ];
    for (const url of urls) expect(parseTweetStatusUrl(url)).toBe(id);
  });

  it("keeps tiny legacy ids intact", () => {
    expect(parseTweetStatusUrl("http://x.com/u/status/20")).toBe("20");
  });

  it("returns null for everything else", () => {
    const rejected = [
      "https://x.com/RusiaSeMueve",
      "https://x.com/i/lists/1",
      "https://notx.com/u/status/12345678901234567890",
      "https://x.com.evil.com/u/status/12345678901234567890",
      "https://example.com/u/status/12345678901234567890",
      "ftp://x.com/u/status/123",
      "not a url",
      "javascript:alert(1)",
      "",
    ];
    for (const url of rejected) expect(parseTweetStatusUrl(url)).toBeNull();
  });
});

const fxPost = (
  id: string,
  text: string,
  authorId = "a1",
  media: unknown = {},
) => ({
  id,
  text,
  author: { id: authorId, name: "Autor", screen_name: "autor" },
  media,
});

const fxResponse = (thread: unknown[]) =>
  new Response(JSON.stringify({ code: 200, thread }), {
    headers: { "content-type": "application/json" },
  });

const threadRequest = (rawUrl: string) =>
  new Request(
    `https://app.example/api/thread?url=${encodeURIComponent(rawUrl)}`,
  );

describe("mediaCountOf", () => {
  it("counts both observed media shapes", () => {
    expect(mediaCountOf({})).toBe(0);
    expect(mediaCountOf([])).toBe(0);
    expect(mediaCountOf({ all: [1, 2] })).toBe(2);
    expect(mediaCountOf([1])).toBe(1);
  });
});

describe("assembleThread", () => {
  it("joins posts in order with media markers as their own paragraphs", () => {
    const posts = [
      {
        id: "1",
        text: " Uno ",
        authorId: "a",
        authorName: "N",
        authorHandle: "n",
        mediaCount: 0,
      },
      {
        id: "2",
        text: "",
        authorId: "a",
        authorName: "N",
        authorHandle: "n",
        mediaCount: 2,
      },
      {
        id: "3",
        text: "Dos",
        authorId: "a",
        authorName: "N",
        authorHandle: "n",
        mediaCount: 0,
      },
    ];
    const result = assembleThread(posts);
    expect(result.text).toBe("Uno\n\n[📷 2]\n\nDos");
    expect(result.title).toBe("Uno");
    expect(result.author).toBe("N (@n)");
    expect(result.tweetCount).toBe(3);
  });
});

describe("handleThread", () => {
  const id = "2110631479294431539";

  it("fetches the FxTwitter thread and returns the assembled article", async () => {
    const fetchImpl = vi.fn(async () =>
      fxResponse([
        fxPost(id, "Pedro Baños ha dedicado un video."),
        fxPost("2", "Segundo post."),
      ]),
    );
    const response = await handleThread(
      threadRequest(`https://x.com/RusiaSeMueve/status/${id}`),
      fetchImpl as unknown as typeof fetch,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      title: "Pedro Baños ha dedicado un video.",
      author: "Autor (@autor)",
      text: "Pedro Baños ha dedicado un video.\n\nSegundo post.",
      tweetCount: 2,
      partial: false,
      source: "fxtwitter",
    });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(`https://api.fxtwitter.com/2/thread/${id}`);
    expect((init.headers as Record<string, string>)["User-Agent"]).toBe(
      "quiosco/1.0",
    );
  });

  it("anchors on the shared post's author when the chain mixes authors", async () => {
    const replyId = "2110632189494775819";
    const fetchImpl = vi.fn(async () =>
      fxResponse([
        fxPost(id, "Pedro Baños ha dedicado un video.", "a1"),
        fxPost(replyId, "@RusiaSeMueve ¡Gracias, Ric!", "a2"),
      ]),
    );
    const response = await handleThread(
      threadRequest(`https://x.com/marcmarginedas/status/${replyId}`),
      fetchImpl as unknown as typeof fetch,
    );
    expect(await response.json()).toMatchObject({
      title: "@RusiaSeMueve ¡Gracias, Ric!",
      text: "@RusiaSeMueve ¡Gracias, Ric!",
      tweetCount: 1,
    });
  });

  it("falls back on an empty FxTwitter thread and reports upstream when both sources fail", async () => {
    const fetchImpl = vi.fn(async (input: unknown) => {
      if (String(input).includes("fxtwitter")) return fxResponse([]);
      throw new Error("offline");
    });
    const response = await handleThread(
      threadRequest(`https://x.com/u/status/${id}`),
      fetchImpl as unknown as typeof fetch,
    );
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "upstream" });
    expect(
      fetchImpl.mock.calls.some(([input]) =>
        String(input).includes("cdn.syndication.twimg.com"),
      ),
    ).toBe(true);
  });

  it("rejects URLs that are not posts", async () => {
    const response = await handleThread(
      threadRequest("https://x.com/RusiaSeMueve"),
      vi.fn() as unknown as typeof fetch,
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid-url" });
  });

  it("dedupes repeated ids from FxTwitter", async () => {
    const fetchImpl = vi.fn(async () =>
      fxResponse([fxPost(id, "Uno."), fxPost(id, "Uno.")]),
    );
    const response = await handleThread(
      threadRequest(`https://x.com/u/status/${id}`),
      fetchImpl as unknown as typeof fetch,
    );
    expect(await response.json()).toMatchObject({
      text: "Uno.",
      tweetCount: 1,
    });
  });
});

describe("syndicationToken", () => {
  it("matches the react-tweet algorithm for a real snowflake", () => {
    expect(syndicationToken("2110631479294431539")).toBe("546qsodt7l4");
  });
});

const syndicated = (
  id: string,
  text: string,
  userId = "u1",
  parent?: unknown,
) => ({
  id_str: id,
  text,
  user: { id_str: userId, name: "Autor", screen_name: "autor" },
  ...(parent ? { parent } : {}),
});

describe("handleThread fallback", () => {
  const id = "2110631479294431539";

  it("walks up the syndication parents when FxTwitter fails, flagged partial", async () => {
    const fetchImpl = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes("fxtwitter")) return new Response("", { status: 500 });
      if (url.includes(`id=${id}&`))
        return new Response(
          JSON.stringify(
            syndicated(id, "Segundo.", "u1", syndicated("1", "Primero.", "u1")),
          ),
          { headers: { "content-type": "application/json" } },
        );
      if (url.includes("id=1&"))
        return new Response(JSON.stringify(syndicated("1", "Primero.", "u1")), {
          headers: { "content-type": "application/json" },
        });
      return new Response("", { status: 404 });
    });
    const response = await handleThread(
      threadRequest(`https://x.com/u/status/${id}`),
      fetchImpl as unknown as typeof fetch,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      title: "Primero.",
      author: "Autor (@autor)",
      text: "Primero.\n\nSegundo.",
      tweetCount: 2,
      partial: true,
      source: "syndication",
    });
  });

  it("filters the walked chain to the shared post's author", async () => {
    const replyId = "2110632189494775819";
    const fetchImpl = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes("fxtwitter")) return new Response("", { status: 500 });
      if (url.includes(`id=${replyId}&`))
        return new Response(
          JSON.stringify(
            syndicated(
              replyId,
              "@RusiaSeMueve ¡Gracias, Ric!",
              "u2",
              syndicated("1", "Pedro Baños…", "u1"),
            ),
          ),
          { headers: { "content-type": "application/json" } },
        );
      if (url.includes("id=1&"))
        return new Response(
          JSON.stringify(syndicated("1", "Pedro Baños…", "u1")),
          {
            headers: { "content-type": "application/json" },
          },
        );
      return new Response("", { status: 404 });
    });
    const response = await handleThread(
      threadRequest(`https://x.com/marcmarginedas/status/${replyId}`),
      fetchImpl as unknown as typeof fetch,
    );
    expect(await response.json()).toMatchObject({
      text: "@RusiaSeMueve ¡Gracias, Ric!",
      tweetCount: 1,
      partial: true,
    });
  });

  it("terminates on a cyclic parent chain", async () => {
    const fetchImpl = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes("fxtwitter")) return new Response("", { status: 500 });
      const match = /id=(\w+)/.exec(url);
      const current = match?.[1] ?? "x";
      const next = current === id ? "loop" : id;
      return new Response(
        JSON.stringify(
          syndicated(
            current,
            `post ${current}`,
            "u1",
            syndicated(next, `post ${next}`, "u1"),
          ),
        ),
        { headers: { "content-type": "application/json" } },
      );
    });
    const response = await handleThread(
      threadRequest(`https://x.com/u/status/${id}`),
      fetchImpl as unknown as typeof fetch,
    );
    expect(response.status).toBe(200);
    const syndicationCalls = fetchImpl.mock.calls.filter(([input]) =>
      String(input).includes("syndication"),
    );
    expect(syndicationCalls.length).toBeLessThanOrEqual(MAX_WALK_HOPS + 1);
  });

  it("maps not-found to 404 (HTTP or body code) and mixed failures to upstream", async () => {
    const notFound = vi.fn(async (input: unknown) =>
      String(input).includes("fxtwitter")
        ? new Response(JSON.stringify({ code: 404 }), {
            headers: { "content-type": "application/json" },
          })
        : new Response("", { status: 404 }),
    );
    const both404 = await handleThread(
      threadRequest(`https://x.com/u/status/${id}`),
      notFound as unknown as typeof fetch,
    );
    expect(both404.status).toBe(404);
    expect(await both404.json()).toEqual({ error: "not-found" });

    const offline = vi.fn(async () => {
      throw new Error("offline");
    });
    const bothOffline = await handleThread(
      threadRequest(`https://x.com/u/status/${id}`),
      offline as unknown as typeof fetch,
    );
    expect(bothOffline.status).toBe(502);
  });

  it("keeps the posts collected so far when a parent fetch fails mid-walk", async () => {
    const fetchImpl = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes("fxtwitter")) return new Response("", { status: 500 });
      if (url.includes(`id=${id}&`))
        return new Response(
          JSON.stringify(
            syndicated(
              id,
              "El post compartido.",
              "u1",
              syndicated("1", "Padre.", "u1"),
            ),
          ),
          { headers: { "content-type": "application/json" } },
        );
      return new Response("", { status: 404 });
    });
    const response = await handleThread(
      threadRequest(`https://x.com/u/status/${id}`),
      fetchImpl as unknown as typeof fetch,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      text: "El post compartido.",
      tweetCount: 1,
      partial: true,
      source: "syndication",
    });
  });

  it("stops at the hop cap on a long chain of unique posts", async () => {
    let hop = 0;
    const fetchImpl = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes("fxtwitter")) return new Response("", { status: 500 });
      hop += 1;
      return new Response(
        JSON.stringify(
          syndicated(
            `p${hop}`,
            `post ${hop}`,
            "u1",
            syndicated(`p${hop + 1}`, `post ${hop + 1}`, "u1"),
          ),
        ),
        { headers: { "content-type": "application/json" } },
      );
    });
    const response = await handleThread(
      threadRequest(`https://x.com/u/status/${id}`),
      fetchImpl as unknown as typeof fetch,
    );
    expect(response.status).toBe(200);
    const syndicationCalls = fetchImpl.mock.calls.filter(([input]) =>
      String(input).includes("syndication"),
    );
    expect(syndicationCalls.length).toBe(MAX_WALK_HOPS);
  });

  it("errors instead of returning an empty article when every post has no text", async () => {
    const fetchImpl = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes("fxtwitter")) return fxResponse([fxPost(id, "", "a1")]);
      return new Response(JSON.stringify(syndicated(id, "", "u1")), {
        headers: { "content-type": "application/json" },
      });
    });
    const response = await handleThread(
      threadRequest(`https://x.com/u/status/${id}`),
      fetchImpl as unknown as typeof fetch,
    );
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "upstream" });
  });

  it("maps a 404 from FxTwitter's HTTP status alone", async () => {
    const fetchImpl = vi.fn(async (input: unknown) => {
      if (String(input).includes("fxtwitter"))
        return new Response("", { status: 404 });
      throw new Error("offline");
    });
    const response = await handleThread(
      threadRequest(`https://x.com/u/status/${id}`),
      fetchImpl as unknown as typeof fetch,
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not-found" });
  });

  it("maps a 404 from FxTwitter's body code alone", async () => {
    const fetchImpl = vi.fn(async (input: unknown) => {
      if (String(input).includes("fxtwitter"))
        return new Response(JSON.stringify({ code: 404 }), {
          headers: { "content-type": "application/json" },
        });
      throw new Error("offline");
    });
    const response = await handleThread(
      threadRequest(`https://x.com/u/status/${id}`),
      fetchImpl as unknown as typeof fetch,
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not-found" });
  });

  it("maps a 404 from the syndication source alone", async () => {
    const fetchImpl = vi.fn(async (input: unknown) =>
      String(input).includes("fxtwitter")
        ? new Response("", { status: 500 })
        : new Response("", { status: 404 }),
    );
    const response = await handleThread(
      threadRequest(`https://x.com/u/status/${id}`),
      fetchImpl as unknown as typeof fetch,
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not-found" });
  });
});
