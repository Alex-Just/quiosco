// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { randomUUID } from "node:crypto";
import { openDB } from "idb";
import { describe, expect, it, vi } from "vitest";
import { createStore } from "./store";
import { STORE_CHANGE_EVENT } from "./storeEvents";
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

  it("notifies local listeners when a streamed partial is persisted", async () => {
    const store = await createStore(`test-${randomUUID()}`);
    const article = makeArticle();
    await store.put(article);
    const handler = vi.fn();
    window.addEventListener(STORE_CHANGE_EVENT, handler);
    await store.update(article.id, { partial: "Hola" });
    window.removeEventListener(STORE_CHANGE_EVENT, handler);
    expect(handler).toHaveBeenCalled();
    const event = handler.mock.calls.at(-1)?.[0] as CustomEvent;
    expect(event.detail).toEqual({ id: article.id });
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

  it("marks writes dirty and keeps tombstones for removed rows", async () => {
    const store = await createStore(`test-${randomUUID()}`);
    const article = makeArticle();
    await store.put(article);
    expect((await store.get(article.id))?.dirty).toBe(true);

    await store.update(article.id, { status: "read" });
    expect((await store.get(article.id))?.dirty).toBe(true);

    await store.remove(article.id);
    expect(await store.get(article.id)).toBeUndefined();
    expect(await store.findByUrl(article.url ?? "")).toBeUndefined();
    expect((await store.list()).map((a) => a.id)).not.toContain(article.id);
    const all = await store.listAll();
    expect(all.find((a) => a.id === article.id)).toMatchObject({
      deleted: true,
    });
    store.close();
  });

  it("applies remote rows without dirtying them and reports local writes", async () => {
    const changes: number[] = [];
    const store = await createStore(`test-${randomUUID()}`, () =>
      changes.push(1),
    );
    const article = makeArticle({ dirty: true });
    await store.put(article);
    await store.applyRemote([{ ...article, dirty: false, title: "Remote" }]);
    expect((await store.get(article.id))?.dirty).toBe(false);
    expect((await store.get(article.id))?.title).toBe("Remote");
    expect(changes.length).toBe(1); // only put() notified
    store.close();
  });

  it("stores a scroll position per article and clears it on remove", async () => {
    const store = await createStore(`test-${randomUUID()}`);
    const article = makeArticle();
    const other = makeArticle();
    await store.put(article);
    await store.put(other);
    expect(await store.getScrollPosition(article.id)).toBeNull();

    await store.setScrollPosition(article.id, 812, "original");
    await store.setScrollPosition(other.id, 120, "translation");
    expect(await store.getScrollPosition(article.id)).toMatchObject({
      y: 812,
      view: "original",
    });
    expect(await store.getScrollPosition(other.id)).toMatchObject({ y: 120 });

    await store.remove(article.id);
    expect(await store.getScrollPosition(article.id)).toBeNull();
    expect(await store.getScrollPosition(other.id)).not.toBeNull();
    store.close();
  });

  it("keeps zenIndex when scroll y is updated, and the reverse", async () => {
    const store = await createStore(`test-${randomUUID()}`);
    const article = makeArticle();
    await store.put(article);
    await store.setScrollPosition(article.id, 0, "translation", 11);
    await store.setScrollPosition(article.id, 400, "translation");
    expect(await store.getScrollPosition(article.id)).toMatchObject({
      y: 400,
      zenIndex: 11,
    });
    await store.setScrollPosition(article.id, 400, "original", 3);
    expect(await store.getScrollPosition(article.id)).toMatchObject({
      y: 400,
      view: "original",
      zenIndex: 3,
    });
    store.close();
  });

  it("round-trips sentence cache entries in batches", async () => {
    const store = await createStore(`test-${randomUUID()}`);
    const entry = {
      key: "k1",
      source: "El Sr. García llegó.",
      translation: "Mr. García arrived.",
      targetLanguage: "English",
      rulesHash: "r1",
      model: "m",
      createdAt: 1,
    };
    await store.putSentences([entry, { ...entry, key: "k2" }]);
    const found = await store.getSentences(["k1", "missing", "k2"]);
    expect(found.map((e) => e.key).sort()).toEqual(["k1", "k2"]);
    expect(found[0]?.translation).toBe("Mr. García arrived.");
    store.close();
  });

  it("upgrades a v2 database without losing articles or positions", async () => {
    const name = `test-${randomUUID()}`;
    const legacy = await openDB(name, 2, {
      upgrade(db) {
        const articles = db.createObjectStore("articles", { keyPath: "id" });
        articles.createIndex("createdAt", "createdAt");
        articles.createIndex("url", "url");
        db.createObjectStore("positions", { keyPath: "id" });
      },
    });
    await legacy.put("articles", makeArticle());
    const id = await legacy.getAllKeys("articles");
    await legacy.put("positions", {
      id: id[0],
      y: 5,
      view: "original",
      updatedAt: 1,
    });
    legacy.close();

    const store = await createStore(name);
    expect(await store.list()).toHaveLength(1);
    expect(await store.getScrollPosition(String(id[0]))).toMatchObject({
      y: 5,
    });
    await store.putSentences([]);
    store.close();
  });

  it("deleting a book hard-deletes it but leaves its sentence cache intact", async () => {
    const store = await createStore(`test-${randomUUID()}`);
    const book = makeArticle({ kind: "book" });
    await store.put(book);
    await store.putSentences([
      {
        key: "k1",
        source: "Hola.",
        translation: "Hi.",
        targetLanguage: "English",
        rulesHash: "r1",
        model: "m",
        createdAt: 1,
      },
    ]);
    await store.remove(book.id);
    expect(await store.get(book.id)).toBeUndefined();
    expect((await store.listAll()).some((row) => row.id === book.id)).toBe(
      false,
    );
    expect(await store.getSentences(["k1"])).toHaveLength(1);
    store.close();
  });
});
