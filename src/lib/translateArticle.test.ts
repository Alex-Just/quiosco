import { afterEach, describe, expect, it, vi } from "vitest";
import { newArticle } from "./article";
import { CLEANUP_SYSTEM_PROMPT } from "./cleanWithLlm";
import type { ArticleStore } from "./store";
import { cancelTranslation, translateArticle } from "./translateArticle";
import type { Article, Settings } from "./types";

const settings: Settings = {
  targetLanguage: "English",
  rules: "",
  model: "m",
  appToken: "t",
  autoTranslate: true,
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
    expect(updates.some((patch) => patch.translation === "Translated.")).toBe(
      true,
    );
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
    });
  });
});
