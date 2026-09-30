import { describe, expect, it } from "vitest";
import {
  type CacheStorageLike,
  clearPendingShare,
  readPendingShare,
  storePendingShare,
} from "./sharePayload";

class FakeCache {
  store = new Map<string, Response>();
  async match(key: string) {
    return this.store.get(key);
  }
  async put(key: string, response: Response) {
    this.store.set(key, response);
  }
  async delete(key: string) {
    return this.store.delete(key);
  }
}

const fakeCacheStorage = () => {
  const caches = new Map<string, FakeCache>();
  const storage: CacheStorageLike = {
    async open(name: string) {
      let cache = caches.get(name);
      if (!cache) {
        cache = new FakeCache();
        caches.set(name, cache);
      }
      return cache;
    },
  };
  return storage;
};

describe("sharePayload", () => {
  it("stores, reads, and clears a pending share", async () => {
    const storage = fakeCacheStorage();
    const payload = {
      title: "T",
      text: "cuerpo",
      url: "https://e.com/a",
      receivedAt: 123,
    };
    await storePendingShare(payload, storage);
    await expect(readPendingShare(storage)).resolves.toEqual(payload);
    await clearPendingShare(storage);
    await expect(readPendingShare(storage)).resolves.toBeNull();
  });

  it("returns null for garbage payloads", async () => {
    const storage = fakeCacheStorage();
    const cache = await storage.open("quiosco-share");
    await cache.put("/__pending-share", new Response("not json"));
    await expect(readPendingShare(storage)).resolves.toBeNull();
  });
});
