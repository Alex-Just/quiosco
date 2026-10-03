import "fake-indexeddb/auto";
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "./api";
import { createStore } from "./store";
import { syncNow } from "./sync";
import type { Article, Settings, SyncRequest, SyncResponse } from "./types";

function fakeStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
  };
}

const settings: Settings = {
  targetLanguage: "English",
  rules: "",
  model: "m",
  appToken: "t",
  autoTranslate: true,
  updatedAt: 10,
};

const makeArticle = (patch: Partial<Article> = {}): Article => ({
  id: randomUUID(),
  url: null,
  title: "Título",
  site: null,
  text: "texto",
  via: "manual",
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

const fakeApi = (handler: (request: SyncRequest) => SyncResponse) =>
  ({
    sync: vi.fn(async (request: SyncRequest) => handler(request)),
  }) as unknown as ApiClient;

describe("syncNow", () => {
  it("pushes dirty rows and clears dirty from the echo", async () => {
    const store = await createStore(`test-${randomUUID()}`);
    const article = makeArticle();
    await store.put(article);
    const seen: SyncRequest[] = [];
    const api = fakeApi((request) => {
      seen.push(request);
      return {
        cursor: 5,
        articles: request.articles.map((row) => ({ ...row })),
        settings: null,
      };
    });
    const summary = await syncNow(store, settings, api, fakeStorage());
    expect(summary.pushed).toBe(1);
    expect(seen[0]?.articles[0]?.id).toBe(article.id);
    expect((await store.listAll())[0]?.dirty).toBe(false);
    store.close();
  });

  it("applies remote rows, keeps newer local edits and dispatches an event", async () => {
    const store = await createStore(`test-${randomUUID()}`);
    const local = makeArticle({ updatedAt: 100 });
    await store.put(local);
    const remoteNewer = {
      ...local,
      updatedAt: 200,
      title: "Remote",
      dirty: false,
    };
    const remoteOlder = makeArticle({ updatedAt: 50 });
    const events: number[] = [];
    vi.stubGlobal("window", { dispatchEvent: () => events.push(1) });
    const api = fakeApi(() => ({
      cursor: 9,
      articles: [
        {
          id: remoteNewer.id,
          updatedAt: 200,
          deleted: false,
          data: JSON.stringify(remoteNewer),
        },
        {
          id: remoteOlder.id,
          updatedAt: 50,
          deleted: false,
          data: JSON.stringify(remoteOlder),
        },
      ],
      settings: null,
    }));
    await syncNow(store, settings, api, fakeStorage());
    expect((await store.get(local.id))?.title).toBe("Remote");
    expect((await store.get(remoteOlder.id))?.dirty).toBe(false);
    expect(events.length).toBe(1);
    vi.unstubAllGlobals();
    store.close();
  });

  it("persists the cursor and applies remote settings", async () => {
    const store = await createStore(`test-${randomUUID()}`);
    const storage = fakeStorage();
    const api = fakeApi(() => ({
      cursor: 42,
      articles: [],
      settings: {
        updatedAt: 99,
        data: JSON.stringify({ model: "remote-model" }),
      },
    }));
    await syncNow(store, settings, api, storage);
    expect(storage.getItem("quiosco.sync.cursor")).toBe("42");
    expect(
      JSON.parse(storage.getItem("quiosco.settings.v1") ?? "{}").model,
    ).toBe("remote-model");
    store.close();
  });

  it("splits large dirty queues into batches", async () => {
    const store = await createStore(`test-${randomUUID()}`);
    for (let index = 0; index < 12; index += 1) {
      await store.put(makeArticle());
    }
    const batches: number[] = [];
    const api = fakeApi((request) => {
      batches.push(request.articles.length);
      return { cursor: 1, articles: [], settings: null };
    });
    await syncNow(store, settings, api, fakeStorage());
    expect(batches).toEqual([10, 2]);
    store.close();
  });
});
