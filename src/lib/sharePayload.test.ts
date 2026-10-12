import { describe, expect, it } from "vitest";
import {
  type CacheStorageLike,
  clearPendingBook,
  clearPendingShare,
  readPendingBook,
  readPendingShare,
  storePendingBook,
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

  it("stores, reads, and clears a pending book file", async () => {
    const storage = fakeCacheStorage();
    const file = new File([new Uint8Array([1, 2, 3])], "libro.epub", {
      type: "application/epub+zip",
    });
    await storePendingBook(file, storage);
    const read = await readPendingBook(storage);
    expect(read?.name).toBe("libro.epub");
    expect(read?.type).toBe("application/epub+zip");
    expect(new Uint8Array(await (read as File).arrayBuffer())).toEqual(
      new Uint8Array([1, 2, 3]),
    );
    await clearPendingBook(storage);
    await expect(readPendingBook(storage)).resolves.toBeNull();
  });

  it("round-trips a percent-encoded file name and defaults a missing one", async () => {
    const storage = fakeCacheStorage();
    await storePendingBook(
      new File([new Uint8Array([1])], "mi libro ñoño.epub", {
        type: "application/epub+zip",
      }),
      storage,
    );
    await expect(readPendingBook(storage)).resolves.toMatchObject({
      name: "mi libro ñoño.epub",
    });

    const cache = await storage.open("quiosco-share");
    await cache.put("/__pending-book", new Response(new Uint8Array([1])));
    await expect(readPendingBook(storage)).resolves.toMatchObject({
      name: "book.epub",
    });
  });

  it("treats a zero-byte pending book as nothing received", async () => {
    const storage = fakeCacheStorage();
    const cache = await storage.open("quiosco-share");
    await cache.put("/__pending-book", new Response(new Blob([])));
    await expect(readPendingBook(storage)).resolves.toBeNull();
    // The inert entry is cleaned up rather than left behind.
    await expect(cache.match("/__pending-book")).resolves.toBeUndefined();
  });
});
