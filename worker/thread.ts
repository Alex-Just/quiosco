import { FETCH_TIMEOUT_MS } from "./fetchRung";
import { jsonResponse } from "./headers";

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

export const QUIOSCO_UA = "quiosco/1.0";

export class ThreadError extends Error {
  readonly notFound: boolean;

  constructor(message: string, options: { notFound?: boolean } = {}) {
    super(message);
    this.notFound = options.notFound ?? false;
  }
}

export interface ThreadPost {
  id: string;
  text: string;
  authorId: string;
  authorName: string;
  authorHandle: string;
  mediaCount: number;
}

export interface ThreadResult {
  title: string;
  author: string;
  text: string;
  tweetCount: number;
  partial: boolean;
  source: "fxtwitter" | "syndication";
}

interface FxPost {
  id?: unknown;
  text?: unknown;
  author?: { id?: unknown; name?: unknown; screen_name?: unknown };
  media?: unknown;
}

export function mediaCountOf(media: unknown): number {
  if (Array.isArray(media)) return media.length;
  if (media && typeof media === "object") {
    const all = (media as { all?: unknown }).all;
    if (Array.isArray(all)) return all.length;
  }
  return 0;
}

export function assembleThread(posts: ThreadPost[]): {
  title: string;
  text: string;
  author: string;
  tweetCount: number;
} {
  const blocks: string[] = [];
  for (const post of posts) {
    const text = post.text.trim();
    if (text) blocks.push(text);
    if (post.mediaCount > 0) blocks.push(`[📷 ${post.mediaCount}]`);
  }
  const first = posts[0];
  const firstLine =
    (first?.text ?? "")
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? "";
  const author = first
    ? `${first.authorName} (@${first.authorHandle})`.trim()
    : "";
  return {
    title: firstLine.slice(0, 200),
    text: blocks.join("\n\n"),
    author,
    tweetCount: posts.length,
  };
}

export async function fetchFxThread(
  id: string,
  fetchImpl: typeof fetch,
): Promise<ThreadPost[]> {
  const response = await fetchImpl(`https://api.fxtwitter.com/2/thread/${id}`, {
    headers: { "User-Agent": QUIOSCO_UA },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (response.status === 404)
    throw new ThreadError("post not found", { notFound: true });
  if (!response.ok)
    throw new ThreadError(`fxtwitter status ${response.status}`);
  const data = (await response.json()) as { code?: unknown; thread?: unknown };
  if (data.code === 404)
    throw new ThreadError("post not found", { notFound: true });
  if (
    data.code !== 200 ||
    !Array.isArray(data.thread) ||
    data.thread.length === 0
  )
    throw new ThreadError("fxtwitter unusable response");
  const thread = data.thread as FxPost[];
  const shared = thread.find((post) => String(post.id) === id) ?? thread[0];
  const anchorId = String(shared?.author?.id ?? "");
  const kept = anchorId
    ? thread.filter((post) => String(post.author?.id) === anchorId)
    : thread;
  const seen = new Set<string>();
  const posts: ThreadPost[] = [];
  for (const post of kept) {
    const postId = String(post.id ?? "");
    if (seen.has(postId)) continue;
    seen.add(postId);
    posts.push({
      id: postId,
      text: typeof post.text === "string" ? post.text : "",
      authorId: String(post.author?.id ?? ""),
      authorName: String(post.author?.name ?? ""),
      authorHandle: String(post.author?.screen_name ?? ""),
      mediaCount: mediaCountOf(post.media),
    });
  }
  return posts;
}

export const MAX_WALK_HOPS = 25;

export function syndicationToken(id: string): string {
  return ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, "");
}

export interface SyndicatedPost {
  id_str?: unknown;
  text?: unknown;
  user?: { id_str?: unknown; name?: unknown; screen_name?: unknown };
  parent?: { id_str?: unknown };
  mediaDetails?: unknown;
}

export async function fetchSyndicatedPost(
  id: string,
  fetchImpl: typeof fetch,
): Promise<SyndicatedPost> {
  const url = `https://cdn.syndication.twimg.com/tweet-result?id=${id}&token=${syndicationToken(id)}&lang=en`;
  const response = await fetchImpl(url, {
    headers: { "User-Agent": QUIOSCO_UA },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (response.status === 404)
    throw new ThreadError("post not found", { notFound: true });
  if (!response.ok)
    throw new ThreadError(`syndication status ${response.status}`);
  return (await response.json()) as SyndicatedPost;
}

export async function walkThreadUp(
  sharedId: string,
  fetchImpl: typeof fetch,
): Promise<ThreadPost[]> {
  const seen = new Set<string>();
  const chain: SyndicatedPost[] = [];
  let currentId: string | undefined = sharedId;
  while (currentId && !seen.has(currentId) && chain.length < MAX_WALK_HOPS) {
    seen.add(currentId);
    const post = await fetchSyndicatedPost(currentId, fetchImpl);
    chain.push(post);
    currentId =
      typeof post.parent?.id_str === "string" ? post.parent.id_str : undefined;
  }
  const anchorUserId = chain[0]?.user?.id_str;
  const kept = chain.filter(
    (post) => !anchorUserId || post.user?.id_str === anchorUserId,
  );
  return kept.reverse().map((post) => ({
    id: String(post.id_str ?? ""),
    text: typeof post.text === "string" ? post.text : "",
    authorId: String(post.user?.id_str ?? ""),
    authorName: String(post.user?.name ?? ""),
    authorHandle: String(post.user?.screen_name ?? ""),
    mediaCount: Array.isArray(post.mediaDetails) ? post.mediaDetails.length : 0,
  }));
}

function buildResult(
  posts: ThreadPost[],
  source: ThreadResult["source"],
  partial: boolean,
): ThreadResult {
  const assembled = assembleThread(posts);
  if (!assembled.text.trim()) throw new ThreadError("empty thread");
  return { ...assembled, partial, source };
}

export async function handleThread(
  request: Request,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const raw = new URL(request.url).searchParams.get("url") ?? "";
  const id = parseTweetStatusUrl(raw);
  if (!id) return jsonResponse({ error: "invalid-url" }, 400);
  let sawNotFound = false;
  try {
    const posts = await fetchFxThread(id, fetchImpl);
    return jsonResponse(buildResult(posts, "fxtwitter", false));
  } catch (error) {
    if (error instanceof ThreadError && error.notFound) sawNotFound = true;
  }
  try {
    const posts = await walkThreadUp(id, fetchImpl);
    return jsonResponse(buildResult(posts, "syndication", true));
  } catch (error) {
    if (error instanceof ThreadError && error.notFound) sawNotFound = true;
  }
  return jsonResponse(
    { error: sawNotFound ? "not-found" : "upstream" },
    sawNotFound ? 404 : 502,
  );
}
