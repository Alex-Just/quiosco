import type { SharePayload } from "./types";

export const SHARE_CACHE = "quiosco-share";
export const PENDING_SHARE_KEY = "/__pending-share";

interface CacheLike {
  match(key: string): Promise<Response | undefined>;
  put(key: string, response: Response): Promise<void>;
  delete(key: string): Promise<boolean>;
}

export interface CacheStorageLike {
  open(name: string): Promise<CacheLike>;
}

function defaultCacheStorage(): CacheStorageLike {
  return caches as unknown as CacheStorageLike;
}

export async function storePendingShare(
  payload: SharePayload,
  cacheStorage: CacheStorageLike = defaultCacheStorage(),
): Promise<void> {
  const cache = await cacheStorage.open(SHARE_CACHE);
  await cache.put(
    PENDING_SHARE_KEY,
    new Response(JSON.stringify(payload), {
      headers: { "content-type": "application/json" },
    }),
  );
}

export async function readPendingShare(
  cacheStorage: CacheStorageLike = defaultCacheStorage(),
): Promise<SharePayload | null> {
  const cache = await cacheStorage.open(SHARE_CACHE);
  const response = await cache.match(PENDING_SHARE_KEY);
  if (!response) return null;
  try {
    const data = (await response.json()) as Partial<SharePayload>;
    return {
      title: typeof data.title === "string" ? data.title : "",
      text: typeof data.text === "string" ? data.text : "",
      url: typeof data.url === "string" ? data.url : "",
      receivedAt: typeof data.receivedAt === "number" ? data.receivedAt : 0,
    };
  } catch {
    return null;
  }
}

export async function clearPendingShare(
  cacheStorage: CacheStorageLike = defaultCacheStorage(),
): Promise<void> {
  const cache = await cacheStorage.open(SHARE_CACHE);
  await cache.delete(PENDING_SHARE_KEY);
}
