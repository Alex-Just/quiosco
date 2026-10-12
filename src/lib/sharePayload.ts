import type { SharePayload } from "./types";

export const SHARE_CACHE = "quiosco-share";
export const PENDING_SHARE_KEY = "/__pending-share";
/** Pending EPUB received through the Android share sheet. */
export const PENDING_BOOK_KEY = "/__pending-book";
const BOOK_NAME_HEADER = "x-quiosco-file-name";
const DEFAULT_BOOK_NAME = "book.epub";

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

/** Keep a shared EPUB in the cache until the Add page picks it up. */
export async function storePendingBook(
  file: File,
  cacheStorage: CacheStorageLike = defaultCacheStorage(),
): Promise<void> {
  const cache = await cacheStorage.open(SHARE_CACHE);
  await cache.put(
    PENDING_BOOK_KEY,
    new Response(file, {
      headers: {
        "content-type": file.type || "application/epub+zip",
        [BOOK_NAME_HEADER]: encodeURIComponent(file.name || DEFAULT_BOOK_NAME),
      },
    }),
  );
}

export async function readPendingBook(
  cacheStorage: CacheStorageLike = defaultCacheStorage(),
): Promise<File | null> {
  const cache = await cacheStorage.open(SHARE_CACHE);
  const response = await cache.match(PENDING_BOOK_KEY);
  if (!response) return null;
  const blob = await response.blob();
  // A zero-byte body means the browser shared "nothing" (or a truncated
  // share); treat it as nothing received rather than an unreadable file.
  if (blob.size === 0) {
    await cache.delete(PENDING_BOOK_KEY);
    return null;
  }
  const encodedName = response.headers.get(BOOK_NAME_HEADER);
  let name = DEFAULT_BOOK_NAME;
  if (encodedName) {
    try {
      name = decodeURIComponent(encodedName) || DEFAULT_BOOK_NAME;
    } catch {
      // Keep the default when the header is not valid percent-encoding.
    }
  }
  return new File([blob], name, {
    type: response.headers.get("content-type") ?? "application/epub+zip",
  });
}

export async function clearPendingBook(
  cacheStorage: CacheStorageLike = defaultCacheStorage(),
): Promise<void> {
  const cache = await cacheStorage.open(SHARE_CACHE);
  await cache.delete(PENDING_BOOK_KEY);
}
