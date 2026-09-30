import "fake-indexeddb/auto";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createStore } from "./store";
import type { Article } from "./types";

const makeArticle = (patch: Partial<Article> = {}): Article => ({
  id: randomUUID(),
  url: "https://example.com/a",
  title: "Título",
  site: "example.com",
  text: "texto",
  via: "direct",
  translation: null,
  translationStatus: "pending",
  translatedChunks: 0,
  totalChunks: 0,
  status: "unread",
  error: null,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  ...patch,
});

describe("store", () => {
  it("puts, gets, and lists newest first", async () => {
    const store = await createStore(`test-${randomUUID()}`);
    const first = makeArticle({ createdAt: 1000 });
    const second = makeArticle({ createdAt: 2000 });
    await store.put(first);
    await store.put(second);
    expect((await store.list()).map((a) => a.id)).toEqual([
      second.id,
      first.id,
    ]);
    expect((await store.get(first.id))?.title).toBe("Título");
    store.close();
  });

  it("updates with a patch and bumps updatedAt", async () => {
    const store = await createStore(`test-${randomUUID()}`);
    const article = makeArticle({ updatedAt: 1 });
    await store.put(article);
    const updated = await store.update(article.id, { status: "read" });
    expect(updated.status).toBe("read");
    expect(updated.updatedAt).toBeGreaterThan(1);
    store.close();
  });

  it("throws on updating a missing article", async () => {
    const store = await createStore(`test-${randomUUID()}`);
    await expect(store.update("missing", { status: "read" })).rejects.toThrow(
      "article not found",
    );
    store.close();
  });

  it("finds by url and removes", async () => {
    const store = await createStore(`test-${randomUUID()}`);
    const article = makeArticle();
    await store.put(article);
    expect((await store.findByUrl("https://example.com/a"))?.id).toBe(
      article.id,
    );
    await store.remove(article.id);
    expect(await store.get(article.id)).toBeUndefined();
    store.close();
  });
});
