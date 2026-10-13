import { afterEach, describe, expect, it, vi } from "vitest";
import { newArticle } from "./article";
import { CLEANUP_SYSTEM_PROMPT } from "./cleanWithLlm";
import type { ArticleStore } from "./store";
import {
  cancelTranslation,
  hasRunningTranslation,
  translateArticle,
} from "./translateArticle";
import type { Article, Settings } from "./types";

const settings: Settings = {
  targetLanguage: "English",
  rules: "",
  model: "m",
  appToken: "t",
  autoTranslate: true,
  voice: "elvira",
};

function makeArticle(overrides: Partial<Article> = {}): Article {
  return {
    ...newArticle({
      url: null,
      title: "Un titular",
      text: "Texto original.",
      via: "manual",
    }),
    ...overrides,
  };
}

function fakeStore() {
  const updates: Array<Partial<Article>> = [];
  const store = {
    update: async (_id: string, patch: Partial<Article>) => {
      updates.push(patch);
      return makeArticle(patch);
    },
  } as unknown as ArticleStore;
  return { store, updates };
}

function stubFetch() {
  const systems: string[] = [];
  const impl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { system: string };
    systems.push(body.system);
    const text =
      body.system === CLEANUP_SYSTEM_PROMPT ? "Texto limpio." : "Translated.";
    return new Response(JSON.stringify({ text }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", impl);
  return systems;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("translateArticle", () => {
  it("cleans with the LLM before translating by default", async () => {
    const systems = stubFetch();
    const { store, updates } = fakeStore();
    await translateArticle(store, makeArticle(), settings);
    expect(systems[0]).toBe(CLEANUP_SYSTEM_PROMPT);
    expect(systems.length).toBe(2);
    expect(updates.some((patch) => patch.cleanText === "Texto limpio.")).toBe(
      true,
    );
    expect(updates.some((patch) => patch.model === "m")).toBe(true);
    expect(updates.some((patch) => patch.translation === "Translated.")).toBe(
      true,
    );
  });

  it("records clean and translate durations", async () => {
    stubFetch();
    const { store, updates } = fakeStore();
    await translateArticle(store, makeArticle(), settings);
    expect(updates[0]).toMatchObject({
      translationPhase: "cleaning",
      phaseStartedAt: expect.any(Number),
    });
    expect(
      updates.some(
        (patch) =>
          typeof patch.cleanDurationMs === "number" &&
          patch.translationPhase === "translating",
      ),
    ).toBe(true);
    expect(updates.at(-1)).toMatchObject({
      translationStatus: "done",
      phaseStartedAt: null,
      translateDurationMs: expect.any(Number),
    });
  });

  it("skips clean duration when cleaned text is cached", async () => {
    stubFetch();
    const { store, updates } = fakeStore();
    await translateArticle(
      store,
      makeArticle({
        cleanText: "Ya limpio.",
        cleanDurationMs: 12_000,
      }),
      settings,
    );
    expect(updates[0]).toMatchObject({
      translationPhase: "translating",
      phaseStartedAt: expect.any(Number),
    });
    expect(updates.some((patch) => "cleanDurationMs" in patch)).toBe(false);
    expect(updates.at(-1)).toMatchObject({
      translateDurationMs: expect.any(Number),
    });
  });

  it("skips cleaning when cleanup is false", async () => {
    const systems = stubFetch();
    const { store, updates } = fakeStore();
    await translateArticle(store, makeArticle({ cleanup: false }), settings);
    expect(systems.length).toBe(1);
    expect(systems[0]).not.toBe(CLEANUP_SYSTEM_PROMPT);
    expect(updates.some((patch) => "cleanText" in patch)).toBe(false);
    expect(updates.some((patch) => patch.translation === "Translated.")).toBe(
      true,
    );
  });

  it("reuses the cached cleaned text", async () => {
    const systems = stubFetch();
    const { store, updates } = fakeStore();
    await translateArticle(
      store,
      makeArticle({ cleanText: "Ya limpio." }),
      settings,
    );
    expect(systems.length).toBe(1);
    expect(updates.some((patch) => patch.translation === "Translated.")).toBe(
      true,
    );
  });

  it("cancel keeps the article resumable (pending, no error)", async () => {
    const article = makeArticle();
    const { store, updates } = fakeStore();
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls += 1;
        if (calls === 1) {
          return new Response(JSON.stringify({ text: "Texto limpio." }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        cancelTranslation(article.id);
        throw new DOMException("aborted", "AbortError");
      }),
    );
    await translateArticle(store, article, settings);
    expect(updates.at(-1)).toMatchObject({
      translationStatus: "pending",
      translationPhase: null,
      error: null,
      partial: null,
    });
  });

  it("tracks in-flight runs per article", async () => {
    const article = makeArticle({ cleanup: false });
    const { store } = fakeStore();
    vi.stubGlobal(
      "fetch",
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );
    expect(hasRunningTranslation(article.id)).toBe(false);
    const run = translateArticle(store, article, settings);
    expect(hasRunningTranslation(article.id)).toBe(true);
    cancelTranslation(article.id);
    await run;
    expect(hasRunningTranslation(article.id)).toBe(false);
  });

  it("persists streamed partials separately and clears them on completion", async () => {
    const sse = [
      'data: {"choices":[{"delta":{"content":"Mitad"}}]}',
      "",
      "data: [DONE]",
      "",
    ].join("\n");
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(sse, {
            headers: { "content-type": "text/event-stream" },
          }),
      ),
    );
    const { store, updates } = fakeStore();
    await translateArticle(store, makeArticle({ cleanup: false }), settings);
    expect(
      updates.some(
        (patch) => patch.partial === "Mitad" && patch.translation === "",
      ),
    ).toBe(true);
    expect(updates.at(-1)).toMatchObject({
      translationStatus: "done",
      translation: "Mitad",
      partial: null,
    });
  });

  it("ignores a stale partial on resume and clears it when the run starts", async () => {
    stubFetch();
    const { store, updates } = fakeStore();
    const text = `${"primero ".repeat(1200)}\n\n${"segundo ".repeat(1200)}`;
    await translateArticle(
      store,
      makeArticle({
        cleanup: false,
        text,
        translation: "Chunk one.",
        translatedChunks: 1,
        totalChunks: 2,
        partial: "half of chunk two",
      }),
      settings,
    );
    expect(updates[0]).toMatchObject({ partial: null });
    expect(updates.at(-1)?.translation).toBe("Chunk one.\n\nTranslated.");
  });
});
