const TRACKING_PARAMS = new Set([
  "amp",
  "emk",
  "fbclid",
  "gclid",
  "intcmp",
  "s_kw",
  "ssm",
]);

export function normalizeUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  url.hash = "";

  const params = new URLSearchParams(url.search);
  for (const key of [...params.keys()]) {
    if (/^utm_/i.test(key) || TRACKING_PARAMS.has(key.toLowerCase()))
      params.delete(key);
  }
  const search = params.toString();
  url.search = search ? `?${search}` : "";

  if (url.pathname.endsWith("_amp.html")) {
    url.pathname = `${url.pathname.slice(0, -"_amp.html".length)}.html`;
  }

  return url.toString();
}
