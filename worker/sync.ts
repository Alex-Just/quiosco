import type { Env } from "./env";
import { jsonResponse } from "./headers";

const MAX_ARTICLES_PER_REQUEST = 10;
const MAX_ROW_BYTES = 1_000_000;
const MAX_BODY_BYTES = 4_000_000;
const PULL_LIMIT = 500;

interface ArticleRow {
  id: string;
  updatedAt: number;
  deleted: boolean;
  data: string;
}

interface SettingsRow {
  updatedAt: number;
  data: string;
}

interface SyncRequest {
  cursor: number;
  articles: ArticleRow[];
  settings: SettingsRow | null;
}

interface StoredArticle {
  id: string;
  updated_at: number;
  server_seq: number;
  deleted: number;
  data: string;
}

interface StoredVersion {
  updated_at: number;
  server_seq: number;
  deleted: number;
  data: string;
}

export async function handleSync(
  request: Request,
  env: Env,
): Promise<Response> {
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES)
    return jsonResponse({ error: "too large" }, 413);
  let parsed: SyncRequest | null = null;
  try {
    parsed = parseRequest(JSON.parse(raw));
  } catch {
    parsed = null;
  }
  if (!parsed) return jsonResponse({ error: "bad request" }, 400);

  const now = Date.now();
  const touched: StoredArticle[] = [];

  for (const row of parsed.articles) {
    const stored = await env.DB.prepare(
      "SELECT updated_at, server_seq, deleted, data FROM articles WHERE id = ?",
    )
      .bind(row.id)
      .first<StoredVersion>();
    if (stored && row.updatedAt < stored.updated_at) {
      touched.push({ id: row.id, ...stored });
      continue;
    }
    await env.DB.prepare(
      `INSERT INTO articles (id, updated_at, server_seq, deleted, data)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         updated_at = excluded.updated_at,
         server_seq = excluded.server_seq,
         deleted = excluded.deleted,
         data = excluded.data`,
    )
      .bind(row.id, row.updatedAt, now, row.deleted ? 1 : 0, row.data)
      .run();
    touched.push({
      id: row.id,
      updated_at: row.updatedAt,
      server_seq: now,
      deleted: row.deleted ? 1 : 0,
      data: row.data,
    });
  }

  if (parsed.settings) {
    const stored = await env.DB.prepare(
      "SELECT updated_at FROM settings WHERE id = 'settings'",
    ).first<{ updated_at: number }>();
    if (!stored || parsed.settings.updatedAt >= stored.updated_at) {
      await env.DB.prepare(
        `INSERT INTO settings (id, updated_at, server_seq, data)
         VALUES ('settings', ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           updated_at = excluded.updated_at,
           server_seq = excluded.server_seq,
           data = excluded.data`,
      )
        .bind(parsed.settings.updatedAt, now, parsed.settings.data)
        .run();
    }
  }

  const since = Math.min(parsed.cursor, now);
  const pulled = await env.DB.prepare(
    `SELECT id, updated_at, server_seq, deleted, data FROM articles
     WHERE server_seq >= ? ORDER BY server_seq LIMIT ${PULL_LIMIT}`,
  )
    .bind(since)
    .all<StoredArticle>();

  const storedSettings = await env.DB.prepare(
    "SELECT updated_at, data FROM settings WHERE id = 'settings'",
  ).first<{ updated_at: number; data: string }>();

  const articles = dedupeById(pulled.results ?? [], touched).map((row) => ({
    id: row.id,
    updatedAt: row.updated_at,
    deleted: row.deleted === 1,
    data: row.data,
  }));
  const cursor = (pulled.results ?? []).reduce(
    (max, row) => Math.max(max, row.server_seq),
    parsed.cursor,
  );

  return jsonResponse({
    cursor,
    articles,
    settings: storedSettings
      ? { updatedAt: storedSettings.updated_at, data: storedSettings.data }
      : null,
  });
}

// Union of push-touched rows and pulled rows; the pulled entry wins when both
// contain the same id.
function dedupeById(
  pulled: StoredArticle[],
  touched: StoredArticle[],
): StoredArticle[] {
  const merged = new Map<string, StoredArticle>();
  for (const row of pulled) merged.set(row.id, row);
  for (const row of touched) if (!merged.has(row.id)) merged.set(row.id, row);
  return [...merged.values()];
}

function parseRequest(body: unknown): SyncRequest | null {
  if (typeof body !== "object" || body === null) return null;
  const record = body as Record<string, unknown>;
  const cursor =
    typeof record.cursor === "number" && Number.isFinite(record.cursor)
      ? Math.max(0, Math.floor(record.cursor))
      : 0;
  const rawArticles = Array.isArray(record.articles) ? record.articles : null;
  if (!rawArticles || rawArticles.length > MAX_ARTICLES_PER_REQUEST)
    return null;
  const articles: ArticleRow[] = [];
  for (const entry of rawArticles) {
    if (typeof entry !== "object" || entry === null) return null;
    const row = entry as Record<string, unknown>;
    if (
      typeof row.id !== "string" ||
      row.id.length === 0 ||
      row.id.length > 100
    )
      return null;
    if (typeof row.updatedAt !== "number" || !Number.isFinite(row.updatedAt))
      return null;
    if (typeof row.deleted !== "boolean") return null;
    if (typeof row.data !== "string" || row.data.length > MAX_ROW_BYTES)
      return null;
    articles.push({
      id: row.id,
      updatedAt: row.updatedAt,
      deleted: row.deleted,
      data: row.data,
    });
  }
  let settings: SettingsRow | null = null;
  if (record.settings !== null && record.settings !== undefined) {
    if (typeof record.settings !== "object") return null;
    const row = record.settings as Record<string, unknown>;
    if (typeof row.updatedAt !== "number" || !Number.isFinite(row.updatedAt))
      return null;
    if (typeof row.data !== "string" || row.data.length > MAX_ROW_BYTES)
      return null;
    settings = { updatedAt: row.updatedAt, data: row.data };
  }
  return { cursor, articles, settings };
}
