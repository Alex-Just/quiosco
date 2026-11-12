import { tokensMatch } from "./auth";
import type { D1Like, Env } from "./env";
import { jsonResponse } from "./headers";

/**
 * A deliberately small, single-account kosync server.
 *
 * KOReader's progress sync is a four-endpoint protocol; the app only ever
 * reads the stored position. The account is fixed by the KOSYNC_USER and
 * KOSYNC_KEY secrets, so there is no user table and registration cannot be
 * used to create arbitrary accounts.
 *
 * Protocol notes that matter here:
 * - `password` on /users/create is already md5(plaintext), exactly like the
 *   x-auth-key header. Never hash it again.
 * - `progress` is opaque and must round-trip as a string. It is a CRe XPointer
 *   for EPUBs, which is why the app does not write positions back.
 * - `timestamp` is server time in Unix seconds, not milliseconds.
 * - GET on an unknown document is 200 with an empty object, not 404.
 * - metadata is optional and must survive later PUTs that omit it.
 */

const MAX_BODY_BYTES = 16_384;
const MAX_DOCUMENT_CHARS = 128;
const MAX_FILENAME_CHARS = 512;
const MAX_TITLE_CHARS = 512;
const MAX_AUTHORS_CHARS = 512;
const MAX_DEVICE_CHARS = 128;
const MAX_PROGRESS_CHARS = 512;

/** Only quiosco's own export has deterministic chapter/paragraph XPointers. */
const BILINGUAL_FILENAME = /-bilingual\.epub$/i;
const EXPORT_XPOINTER =
  /^\/body\/DocFragment\[[1-9]\d{0,5}\]\/body\/p\[[1-9]\d{0,5}\]\/br\[1\](?:\.\d{1,6})?$/;
/** Shown by KOReader as the device that last pushed. */
const APP_DEVICE = "Quiosco";

const PROGRESS_COLUMNS =
  "document, filename, title, authors, progress, percentage, device, device_id, updated_at";

export interface KosyncProgressRow {
  document: string;
  filename: string | null;
  title: string | null;
  authors: string | null;
  progress: string;
  percentage: number;
  device: string;
  device_id: string | null;
  updated_at: number;
}

interface KosyncMetadata {
  filename: string | null;
  title: string | null;
  authors: string | null;
}

interface ParsedProgress {
  document: string;
  progress: string;
  percentage: number;
  device: string;
  deviceId: string | null;
  metadata: KosyncMetadata | null;
}

interface BookIdentity {
  filename: string | null;
  title: string | null;
  authors: string | null;
}

function kosyncError(code: number, message: string, status: number): Response {
  return jsonResponse({ code, message }, status);
}

function unauthorized(): Response {
  return kosyncError(2001, "Unauthorized", 401);
}

function invalidRequest(): Response {
  return kosyncError(2003, "Invalid request", 403);
}

function missingDocument(): Response {
  return kosyncError(2004, "Field 'document' not provided.", 403);
}

function cleanString(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed.slice(0, max);
}

function basename(value: string): string {
  const cut = Math.max(value.lastIndexOf("/"), value.lastIndexOf("\\"));
  return cut === -1 ? value : value.slice(cut + 1);
}

function normalizeFilename(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = basename(value.trim());
  return name.length > 0 ? name.slice(0, MAX_FILENAME_CHARS) : null;
}

function validDocument(value: string | null): value is string {
  return value !== null && value.length > 0 && !value.includes(":");
}

/** Collapse `/kosync`, trailing slashes, and duplicated separators. */
function routePath(pathname: string): string {
  return (
    pathname
      .replace(/^\/kosync\/?/, "/")
      .replace(/\/+/g, "/")
      .replace(/\/$/, "") || "/"
  );
}

async function isAuthorized(request: Request, env: Env): Promise<boolean> {
  const configuredUser = env.KOSYNC_USER?.trim();
  const configuredKey = env.KOSYNC_KEY?.trim();
  if (!configuredUser || !configuredKey) return false;
  const user = request.headers.get("x-auth-user");
  const key = request.headers.get("x-auth-key");
  if (!user || !key || user !== configuredUser) return false;
  return tokensMatch(key.toLowerCase(), configuredKey.toLowerCase());
}

async function readJsonBody(
  request: Request,
): Promise<Record<string, unknown> | Response> {
  const declared = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return jsonResponse({ error: "request too large" }, 413);
  }
  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return kosyncError(103, "Could not parse JSON in body.", 400);
  }
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
    return jsonResponse({ error: "request too large" }, 413);
  }
  try {
    const data = JSON.parse(raw) as unknown;
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return kosyncError(104, "Body should be a JSON hash.", 400);
    }
    return data as Record<string, unknown>;
  } catch {
    return kosyncError(103, "Could not parse JSON in body.", 400);
  }
}

function parseMetadata(value: unknown): KosyncMetadata | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const metadata = value as Record<string, unknown>;
  return {
    filename: normalizeFilename(metadata.filename),
    title: cleanString(metadata.title, MAX_TITLE_CHARS),
    authors: cleanString(metadata.authors, MAX_AUTHORS_CHARS),
  };
}

function parseProgress(
  body: Record<string, unknown>,
): ParsedProgress | Response {
  const document = cleanString(body.document, MAX_DOCUMENT_CHARS);
  if (!validDocument(document)) return missingDocument();

  if (typeof body.progress !== "string") return invalidRequest();
  const percentage = body.percentage;
  if (typeof percentage !== "number" || !Number.isFinite(percentage)) {
    return invalidRequest();
  }
  const device = cleanString(body.device, MAX_DEVICE_CHARS);
  if (!device) return invalidRequest();

  return {
    document,
    progress: body.progress,
    percentage: Math.min(1, Math.max(0, percentage)),
    device,
    deviceId: cleanString(body.device_id, MAX_DEVICE_CHARS),
    metadata: parseMetadata(body.metadata),
  };
}

async function createUser(request: Request, env: Env): Promise<Response> {
  // One configured account: registration is closed to everyone else, and the
  // one account can register idempotently so the KOReader button works.
  const configuredUser = env.KOSYNC_USER?.trim();
  const configuredKey = env.KOSYNC_KEY?.trim();
  if (!configuredUser || !configuredKey) {
    return kosyncError(2005, "User registration is disabled.", 402);
  }
  const body = await readJsonBody(request);
  if (body instanceof Response) return body;

  const username = cleanString(body.username, MAX_DEVICE_CHARS);
  const password = cleanString(body.password, MAX_DEVICE_CHARS);
  if (!username || !password || username.includes(":")) return invalidRequest();
  if (username !== configuredUser) {
    return kosyncError(2005, "User registration is disabled.", 402);
  }
  if (
    !(await tokensMatch(password.toLowerCase(), configuredKey.toLowerCase()))
  ) {
    return kosyncError(2002, "Username is already registered.", 402);
  }
  return jsonResponse({ username }, 201);
}

async function storeProgress(
  db: D1Like,
  row: KosyncProgressRow,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO kosync_progress (${PROGRESS_COLUMNS})
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(document) DO UPDATE SET
         filename = COALESCE(excluded.filename, kosync_progress.filename),
         title = COALESCE(excluded.title, kosync_progress.title),
         authors = COALESCE(excluded.authors, kosync_progress.authors),
         progress = excluded.progress,
         percentage = excluded.percentage,
         device = excluded.device,
         device_id = COALESCE(excluded.device_id, kosync_progress.device_id),
         updated_at = excluded.updated_at`,
    )
    .bind(
      row.document,
      row.filename,
      row.title,
      row.authors,
      row.progress,
      row.percentage,
      row.device,
      row.device_id,
      row.updated_at,
    )
    .run();
}

async function findProgress(
  db: D1Like,
  document: string,
): Promise<KosyncProgressRow | null> {
  return db
    .prepare(
      `SELECT ${PROGRESS_COLUMNS} FROM kosync_progress WHERE document = ?`,
    )
    .bind(document)
    .first<KosyncProgressRow>();
}

async function findProgressByFilename(
  db: D1Like,
  filename: string,
): Promise<KosyncProgressRow | null> {
  return db
    .prepare(
      `SELECT ${PROGRESS_COLUMNS} FROM kosync_progress
       WHERE filename = ? COLLATE NOCASE
       ORDER BY updated_at DESC
       LIMIT 1`,
    )
    .bind(filename)
    .first<KosyncProgressRow>();
}

function progressResponse(row: KosyncProgressRow): Record<string, unknown> {
  return {
    document: row.document,
    percentage: row.percentage,
    progress: row.progress,
    device: row.device,
    timestamp: row.updated_at,
    ...(row.device_id ? { device_id: row.device_id } : {}),
  };
}

async function findLinkedProgress(
  db: D1Like,
  identity: BookIdentity,
): Promise<KosyncProgressRow | null> {
  if (identity.filename) {
    const byFilename = await findProgressByFilename(db, identity.filename);
    if (byFilename) return byFilename;
  }
  if (!identity.title) return null;

  if (identity.authors) {
    const byTitleAndAuthor = await db
      .prepare(
        `SELECT ${PROGRESS_COLUMNS} FROM kosync_progress
         WHERE title = ? COLLATE NOCASE AND authors = ? COLLATE NOCASE
         ORDER BY updated_at DESC
         LIMIT 1`,
      )
      .bind(identity.title, identity.authors)
      .first<KosyncProgressRow>();
    if (byTitleAndAuthor) return byTitleAndAuthor;
  }

  // Author formatting differs across tools ("Dickens, Charles" vs "Charles
  // Dickens"). Fall back to the title only when it identifies one document.
  const byTitle = await db
    .prepare(
      `SELECT ${PROGRESS_COLUMNS} FROM kosync_progress
       WHERE title = ? COLLATE NOCASE
       ORDER BY updated_at DESC
       LIMIT 2`,
    )
    .bind(identity.title)
    .all<KosyncProgressRow>();
  const rows = byTitle.results ?? [];
  const first = rows[0];
  if (!first) return null;
  return rows.every((row) => row.document === first.document) ? first : null;
}

function lookupResponse(row: KosyncProgressRow): Record<string, unknown> {
  return {
    document: row.document,
    filename: row.filename,
    percentage: row.percentage,
    progress: row.progress,
    device: row.device,
    updatedAt: row.updated_at,
    title: row.title,
    authors: row.authors,
  };
}

export async function handleKosync(
  request: Request,
  env: Env,
  url: URL,
): Promise<Response> {
  const path = routePath(url.pathname);

  if (path === "/healthcheck" && request.method === "GET") {
    return jsonResponse({ state: "OK" });
  }
  if (path === "/users/create" && request.method === "POST") {
    return createUser(request, env);
  }
  if (path === "/users/auth" && request.method === "GET") {
    if (!(await isAuthorized(request, env))) return unauthorized();
    return jsonResponse({ authorized: "OK" });
  }
  if (path === "/syncs/progress" && request.method === "PUT") {
    if (!(await isAuthorized(request, env))) return unauthorized();
    const body = await readJsonBody(request);
    if (body instanceof Response) return body;
    const parsed = parseProgress(body);
    if (parsed instanceof Response) return parsed;

    const timestamp = Math.floor(Date.now() / 1000);
    await storeProgress(env.DB, {
      document: parsed.document,
      filename: parsed.metadata?.filename ?? null,
      title: parsed.metadata?.title ?? null,
      authors: parsed.metadata?.authors ?? null,
      progress: parsed.progress,
      percentage: parsed.percentage,
      device: parsed.device,
      device_id: parsed.deviceId,
      updated_at: timestamp,
    });
    return jsonResponse({ document: parsed.document, timestamp });
  }
  if (path.startsWith("/syncs/progress/") && request.method === "GET") {
    if (!(await isAuthorized(request, env))) return unauthorized();
    let document: string | null;
    try {
      document = cleanString(
        decodeURIComponent(path.slice("/syncs/progress/".length)),
        MAX_DOCUMENT_CHARS,
      );
    } catch {
      document = null;
    }
    if (!validDocument(document)) return missingDocument();
    const row = await findProgress(env.DB, document);
    return jsonResponse(row ? progressResponse(row) : {});
  }
  return jsonResponse({ error: "not found" }, 404);
}

/** App-facing read: match a quiosco book to the last KOReader push. */
export async function handleKosyncLookup(
  request: Request,
  env: Env,
): Promise<Response> {
  // Removing the secrets disables the bridge for reads too, not just pushes.
  if (!env.KOSYNC_USER?.trim() || !env.KOSYNC_KEY?.trim()) {
    return jsonResponse({ progress: null });
  }
  const url = new URL(request.url);
  const identity: BookIdentity = {
    filename: normalizeFilename(url.searchParams.get("filename")),
    title: cleanString(url.searchParams.get("title"), MAX_TITLE_CHARS),
    authors: cleanString(
      url.searchParams.get("author") ?? url.searchParams.get("authors"),
      MAX_AUTHORS_CHARS,
    ),
  };
  if (!identity.filename && !identity.title) {
    return jsonResponse({ error: "missing book" }, 400);
  }
  const row = await findLinkedProgress(env.DB, identity);
  return jsonResponse({ progress: row ? lookupResponse(row) : null });
}

/**
 * App-facing write: push the reader's exact position for a bilingual export.
 *
 * KOReader stores the EPUB position as a CRe XPointer. quiosco can only
 * generate one for a `*-bilingual.epub` it produced itself, so this route
 * refuses every other file. The row must already exist: the document id is
 * KOReader's, and the app learns it from the read lookup.
 *
 * `baseUpdatedAt` is the server timestamp the app last saw. The conditional
 * UPDATE is the concurrency guard: if KOReader pushed after that, no row
 * changes and the app stops for the session instead of clobbering it.
 */
export async function handleKosyncPush(
  request: Request,
  env: Env,
): Promise<Response> {
  if (!env.KOSYNC_USER?.trim() || !env.KOSYNC_KEY?.trim()) {
    return jsonResponse({ pushed: false, reason: "disabled" });
  }

  const body = await readJsonBody(request);
  if (body instanceof Response) {
    return body.status === 413
      ? body
      : jsonResponse({ error: "bad request" }, 400);
  }

  const filename = normalizeFilename(body.filename);
  if (!filename) return jsonResponse({ error: "bad request" }, 400);
  if (!BILINGUAL_FILENAME.test(filename)) {
    return jsonResponse({ pushed: false, reason: "not-exact" });
  }

  const progress = cleanString(body.progress, MAX_PROGRESS_CHARS);
  const percentage = body.percentage;
  const baseUpdatedAt = body.baseUpdatedAt;
  if (
    !progress ||
    !EXPORT_XPOINTER.test(progress) ||
    typeof percentage !== "number" ||
    !Number.isFinite(percentage) ||
    percentage < 0 ||
    percentage > 1 ||
    typeof baseUpdatedAt !== "number" ||
    !Number.isInteger(baseUpdatedAt) ||
    baseUpdatedAt < 0
  ) {
    return jsonResponse({ error: "bad request" }, 400);
  }

  const row = await findProgressByFilename(env.DB, filename);
  if (!row?.filename || !BILINGUAL_FILENAME.test(row.filename)) {
    return jsonResponse({ pushed: false, reason: "unlinked" });
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const result = (await env.DB.prepare(
    `UPDATE kosync_progress
     SET progress = ?, percentage = ?, device = ?, device_id = NULL,
         updated_at = ?
     WHERE document = ? AND updated_at <= ?`,
  )
    .bind(
      progress,
      percentage,
      APP_DEVICE,
      timestamp,
      row.document,
      baseUpdatedAt,
    )
    .run()) as { meta?: { changes?: number } } | undefined;

  // Missing changes metadata fails closed: no clobber, retry next change.
  if ((result?.meta?.changes ?? 0) === 0) {
    // A timed-out client can retry after its write actually committed. Adopt
    // only the exact same position; anything else is a real newer push.
    const current = await findProgress(env.DB, row.document);
    if (current?.progress === progress) {
      return jsonResponse({
        pushed: true,
        document: current.document,
        updatedAt: current.updated_at,
      });
    }
    return jsonResponse({ pushed: false, reason: "stale" });
  }
  return jsonResponse({
    pushed: true,
    document: row.document,
    updatedAt: timestamp,
  });
}
