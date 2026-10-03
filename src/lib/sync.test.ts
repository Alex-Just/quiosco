import "fake-indexeddb/auto";
import { randomUUID } from "node:crypto";
import { openDB } from "idb";
import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "./api";
import { isSettingsDirty, loadSettings, SETTINGS_KEY } from "./settings";
import { createStore } from "./store";
import {
  registerSyncRunner,
  runSyncNow,
  type SyncSummary,
  syncNow,
} from "./sync";
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
    expect(summary.pulled).toBe(0);
    expect(seen[0]?.articles[0]?.id).toBe(article.id);
    expect((await store.listAll())[0]?.dirty).toBe(false);
    store.close();
  });

  it("pushes rows from before the dirty flag existed and clears them", async () => {
    const dbName = `test-${randomUUID()}`;
    const store = await createStore(dbName);
    const article = makeArticle();
    // Simulate a row written by an app version without sync: no dirty field.
    const db = await openDB(dbName);
    await db.put("articles", article);
    db.close();

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
    expect(seen[0]?.articles.map((row) => row.id)).toEqual([article.id]);
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

  it("keeps a dirty local row when the remote copy is older", async () => {
    const store = await createStore(`test-${randomUUID()}`);
    const local = makeArticle({ updatedAt: 100, title: "Local" });
    await store.put(local);
    const remoteOlder = {
      ...local,
      updatedAt: 50,
      title: "Remote",
      dirty: false,
    };
    const api = fakeApi(() => ({
      cursor: 9,
      articles: [
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
    const after = await store.get(local.id);
    expect(after?.title).toBe("Local");
    expect(after?.dirty).toBe(true);
    store.close();
  });

  it("skips non-object article data", async () => {
    const store = await createStore(`test-${randomUUID()}`);
    const api = fakeApi(() => ({
      cursor: 7,
      articles: [
        { id: "null-row", updatedAt: 1, deleted: false, data: "null" },
        { id: "array-row", updatedAt: 1, deleted: false, data: "[]" },
      ],
      settings: null,
    }));
    await syncNow(store, settings, api, fakeStorage());
    expect(await store.listAll()).toEqual([]);
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

  it("applies a settings echo with an equal updatedAt and clears dirty", async () => {
    const store = await createStore(`test-${randomUUID()}`);
    const storage = fakeStorage();
    const local: Settings = {
      ...settings,
      updatedAt: 77,
      model: "local-model",
    };
    storage.setItem(SETTINGS_KEY, JSON.stringify(local));
    storage.setItem("quiosco.settings.dirty", "1");
    const api = fakeApi(() => ({
      cursor: 3,
      articles: [],
      settings: {
        updatedAt: 77,
        data: JSON.stringify({
          targetLanguage: "English",
          rules: "",
          model: "echo-model",
          autoTranslate: true,
        }),
      },
    }));
    await syncNow(store, local, api, storage);
    expect(loadSettings(storage).model).toBe("echo-model");
    expect(isSettingsDirty(storage)).toBe(false);
    store.close();
  });

  it("dispatches quiosco:sync for a settings-only response", async () => {
    const store = await createStore(`test-${randomUUID()}`);
    const storage = fakeStorage();
    storage.setItem(
      SETTINGS_KEY,
      JSON.stringify({ ...settings, updatedAt: 1 }),
    );
    const events: string[] = [];
    vi.stubGlobal("window", {
      dispatchEvent: (event: Event) => events.push(event.type),
    });
    const api = fakeApi(() => ({
      cursor: 4,
      articles: [],
      settings: {
        updatedAt: 2,
        data: JSON.stringify({ model: "remote-model" }),
      },
    }));
    await syncNow(store, settings, api, storage);
    expect(events).toEqual(["quiosco:sync"]);
    vi.unstubAllGlobals();
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

  it("serializes overlapping runs through a single in-flight promise", async () => {
    let calls = 0;
    let release: (value: SyncSummary | null) => void = () => {};
    registerSyncRunner(async () => {
      calls += 1;
      return new Promise((resolve) => {
        release = resolve;
      });
    });
    const first = runSyncNow();
    const second = runSyncNow();
    expect(calls).toBe(1);
    release({ pushed: 0, pulled: 0 });
    await expect(first).resolves.toEqual({ pushed: 0, pulled: 0 });
    await expect(second).resolves.toEqual({ pushed: 0, pulled: 0 });
  });

  it("caps the pull drain at 20 pages", async () => {
    const store = await createStore(`test-${randomUUID()}`);
    const fullPage = Array.from({ length: 500 }, (_, index) => ({
      id: `page-row-${index}`,
      updatedAt: 1,
      deleted: false,
      data: "null",
    }));
    let calls = 0;
    const api = fakeApi(() => {
      calls += 1;
      return { cursor: 0, articles: fullPage, settings: null };
    });
    await syncNow(store, settings, api, fakeStorage());
    expect(calls).toBe(21); // 1 initial request + 20 capped drain pages
    store.close();
  });
});
