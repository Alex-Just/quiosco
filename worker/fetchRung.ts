import type { Env } from "./env";
import { jsonResponse } from "./headers";
import { validateTargetUrl } from "./ssrf";

export const FETCH_TIMEOUT_MS = 20_000;
export const MAX_REDIRECTS = 5;
export const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

export const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
export const GOOGLEBOT_UA =
  "Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.6533.119 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";

export class RungError extends Error {}

export interface RungOutcome {
  bytes: Uint8Array<ArrayBuffer>;
  contentType: string | null;
  kind: "html" | "markdown";
  finalUrl: string | null;
}

export async function handleFetchRung(
  request: Request,
  env: Env,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const mode = params.get("mode") ?? "";
  const target = params.get("url") ?? "";
  try {
    const outcome = await runRung(mode, target, env, fetchImpl);
    const headers = new Headers({
      "content-type": outcome.contentType ?? "text/html; charset=utf-8",
      "x-quiosco-via": mode,
      "x-quiosco-kind": outcome.kind,
      "cache-control": "no-store",
    });
    if (outcome.finalUrl) headers.set("x-quiosco-final-url", outcome.finalUrl);
    return new Response(outcome.bytes, { status: 200, headers });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "rung failed";
    return jsonResponse({ error: "rung failed", mode, reason }, 502);
  }
}

export async function runRung(
  mode: string,
  target: string,
  env: Env,
  fetchImpl: typeof fetch = fetch,
): Promise<RungOutcome> {
  const checked = validateTargetUrl(target);
  if (!checked.ok) throw new RungError(`invalid target: ${checked.reason}`);
  const url = checked.url;

  switch (mode) {
    case "direct":
      return fetchHtml(
        url,
        {
          "User-Agent": BROWSER_UA,
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
        },
        fetchImpl,
      );
    case "googlebot":
      return fetchHtml(
        url,
        { "User-Agent": GOOGLEBOT_UA, "Accept-Language": "es-ES,es;q=0.9" },
        fetchImpl,
      );
    case "jina": {
      const target = url.toString().split("#")[0] ?? url.toString();
      const jinaUrl = new URL(`https://r.jina.ai/${target}`);
      const headers: Record<string, string> = { Accept: "text/plain" };
      if (env.JINA_API_KEY)
        headers.Authorization = `Bearer ${env.JINA_API_KEY}`;
      const { response, finalUrl } = await fetchWithRedirects(
        jinaUrl,
        headers,
        fetchImpl,
      );
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw new RungError(`upstream status ${response.status}`);
      }
      const bytes = await readBodyWithCap(response);
      return {
        bytes,
        contentType: "text/plain; charset=utf-8",
        kind: "markdown",
        finalUrl,
      };
    }
    case "wayback": {
      const availability = await fetchImpl(
        `https://archive.org/wayback/available?url=${encodeURIComponent(url.toString())}`,
        { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) },
      );
      if (!availability.ok)
        throw new RungError(`wayback availability ${availability.status}`);
      const data = (await availability.json()) as {
        archived_snapshots?: {
          closest?: { available?: boolean; url?: string };
        };
      };
      const snapshot = data.archived_snapshots?.closest;
      if (!snapshot?.available || !snapshot.url)
        throw new RungError("no wayback snapshot");
      const snapshotUrl = snapshot.url
        .replace(/^http:/, "https://")
        .replace(/\/web\/(\d+)\//, "/web/$1id_/");
      const { response, finalUrl } = await fetchWithRedirects(
        new URL(snapshotUrl),
        { "User-Agent": BROWSER_UA },
        fetchImpl,
      );
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw new RungError(`upstream status ${response.status}`);
      }
      const bytes = await readBodyWithCap(response);
      return {
        bytes,
        contentType: sanitizeContentType(response.headers.get("content-type")),
        kind: "html",
        finalUrl,
      };
    }
    case "archive_ph": {
      const newest = new URL(`https://archive.ph/newest/${url.toString()}`);
      const { response, finalUrl } = await fetchWithRedirects(
        newest,
        { "User-Agent": BROWSER_UA },
        fetchImpl,
      );
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw new RungError(`upstream status ${response.status}`);
      }
      if (!finalUrl || finalUrl.includes("/newest/")) {
        await response.body?.cancel().catch(() => undefined);
        throw new RungError("no archive snapshot");
      }
      const bytes = await readBodyWithCap(response);
      return {
        bytes,
        contentType: sanitizeContentType(response.headers.get("content-type")),
        kind: "html",
        finalUrl,
      };
    }
    default:
      throw new RungError(`unknown mode: ${mode}`);
  }
}

async function fetchHtml(
  url: URL,
  headers: Record<string, string>,
  fetchImpl: typeof fetch,
): Promise<RungOutcome> {
  const { response, finalUrl } = await fetchWithRedirects(
    url,
    headers,
    fetchImpl,
  );
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new RungError(`upstream status ${response.status}`);
  }
  const bytes = await readBodyWithCap(response);
  return {
    bytes,
    contentType: sanitizeContentType(response.headers.get("content-type")),
    kind: "html",
    finalUrl,
  };
}

export async function fetchWithRedirects(
  start: URL,
  headers: Record<string, string>,
  fetchImpl: typeof fetch,
  maxRedirects: number = MAX_REDIRECTS,
): Promise<{ response: Response; finalUrl: string }> {
  let current = start;
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const check = validateTargetUrl(current.toString());
    if (!check.ok) throw new RungError(`invalid hop: ${check.reason}`);
    const response = await fetchImpl(check.url.toString(), {
      headers,
      redirect: "manual",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("Location");
      if (!location) throw new RungError("redirect without location");
      await response.body?.cancel().catch(() => undefined);
      current = new URL(location, check.url);
      continue;
    }
    return { response, finalUrl: check.url.toString() };
  }
  throw new RungError("too many redirects");
}

export async function readBodyWithCap(
  response: Response,
  maxBytes: number = MAX_RESPONSE_BYTES,
): Promise<Uint8Array<ArrayBuffer>> {
  if (!response.body) return new Uint8Array(0);
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new RungError("response too large");
    }
    parts.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

function sanitizeContentType(raw: string | null): string | null {
  if (!raw) return null;
  const lowered = raw.toLowerCase();
  const allowed = ["text/html", "application/xhtml+xml", "text/plain"];
  const type =
    allowed.find((candidate) => lowered.startsWith(candidate)) ?? "text/html";
  const charset = /charset=([\w-]+)/.exec(lowered)?.[1];
  return charset ? `${type}; charset=${charset}` : type;
}
