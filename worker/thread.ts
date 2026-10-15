const TWITTER_HOSTS = new Set([
  "x.com",
  "www.x.com",
  "mobile.x.com",
  "m.x.com",
  "twitter.com",
  "www.twitter.com",
  "mobile.twitter.com",
  "m.twitter.com",
]);

const STATUS_PATH = /\/(?:status|statuses)\/(\d{1,20})(?:\/|$)/;

/** Extract the post id from an X/Twitter status URL; null when it is not one. */
export function parseTweetStatusUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (!TWITTER_HOSTS.has(url.hostname.toLowerCase())) return null;
  return STATUS_PATH.exec(url.pathname)?.[1] ?? null;
}
