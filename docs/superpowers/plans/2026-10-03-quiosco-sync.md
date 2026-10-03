# Quiosco Multi-device Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sync articles and settings across the user's devices through Cloudflare D1, keeping the app local-first and offline-capable.

**Architecture:** IndexedDB stays the working store; rows gain `dirty`/`deleted` flags. One Worker endpoint (`POST /api/sync`) exchanges dirty rows (last-write-wins) and rows changed since a server-assigned cursor. Settings sync through the same endpoint; the app token never syncs.

**Tech Stack:** TypeScript, React 19, Vite, Cloudflare Workers + D1 (SQLite), IndexedDB (`idb`), Vitest, Playwright, Biome.

**Spec:** `docs/superpowers/specs/2026-10-03-quiosco-sync-design.md`

## Global Constraints

- Local-first: every feature keeps working offline; sync never wipes local data (merge only).
- Conflict policy: last-write-wins per row by `updatedAt`; deletions via tombstones (`deleted: true`).
- Caps (server-enforced): request body ≤ 4 MB, ≤ 10 article rows per request, row `data` ≤ 1 MB; pull pages of 500.
- Client batching: ≤ 10 rows and ≤ 2 MB per request; loop until the dirty queue is drained.
- The `appToken` is never synced.
- No new runtime dependencies.
- Gates before every commit: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build && pnpm scan`, `pnpm e2e` (e2e only where the task touches UI).
- TDD: write the failing test, watch it fail, implement, watch it pass.
- Worker tests inject fakes through `Env` (no network, no real D1).

---

### Task 1: D1 database, schema, and binding

**Files:**
- Create: `worker/migrations/0001_sync.sql`
- Modify: `wrangler.toml`

**Interfaces:**
- Consumes: nothing.
- Produces: D1 binding `DB` available as `env.DB` in the Worker; local database file used by `wrangler dev` and e2e.

- [ ] **Step 1: Write the migration**

Create `worker/migrations/0001_sync.sql`:

```sql
CREATE TABLE IF NOT EXISTS articles (
  id TEXT PRIMARY KEY,
  updated_at INTEGER NOT NULL,
  server_seq INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  data TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_articles_server_seq ON articles(server_seq);

CREATE TABLE IF NOT EXISTS settings (
  id TEXT PRIMARY KEY,
  updated_at INTEGER NOT NULL,
  server_seq INTEGER NOT NULL,
  data TEXT NOT NULL
);
```

- [ ] **Step 2: Create the database and capture its id**

Run: `pnpm exec wrangler d1 create quiosco`

If this fails with an authentication error (code 10000), the API token lacks D1 permissions — stop and ask the user to add the D1 permission to the token or run `wrangler login`, then re-run. Copy the `database_id` from the output.

- [ ] **Step 3: Add the binding to `wrangler.toml`**

Append (with the real id):

```toml
[[d1_databases]]
binding = "DB"
database_name = "quiosco"
database_id = "<paste the id from step 2>"
```

- [ ] **Step 4: Apply the migration locally and verify**

Run:

```bash
pnpm exec wrangler d1 execute quiosco --local --file worker/migrations/0001_sync.sql
pnpm exec wrangler d1 execute quiosco --local --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
```

Expected: `articles` and `settings` listed.

- [ ] **Step 5: Commit**

```bash
git add worker/migrations/0001_sync.sql wrangler.toml
git commit -m "feat(sync): D1 database schema and binding"
```

---

### Task 2: Worker `/api/sync` handler

**Files:**
- Create: `worker/sync.ts`, `worker/sync.test.ts`
- Modify: `worker/env.ts` (add `DB`), `worker/index.ts` (route)

**Interfaces:**
- Consumes: `env.DB` (D1 binding), `jsonResponse` from `./headers`.
- Produces:
  - `handleSync(request: Request, env: Env): Promise<Response>` — the endpoint.
  - D1 subset types `D1Like`/`D1Statement` exported from `worker/sync.ts`.
  - Request/response JSON shapes:
    - request `{ cursor: number, articles: Array<{id, updatedAt, deleted, data}>, settings: {updatedAt, data} | null }`
    - response `{ cursor: number, articles: Array<{id, updatedAt, deleted, data}>, settings: {updatedAt, data} | null }`

- [ ] **Step 1: Add the D1 binding type to `worker/env.ts`**

```ts
export interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
}

export interface D1Like {
  prepare(sql: string): D1Statement;
}
```

and inside `interface Env` add:

```ts
  DB: D1Like;
```

- [ ] **Step 2: Write the failing tests**

Create `worker/sync.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { D1Like, D1Statement } from "./env";
import type { Env } from "./env";
import { handleSync } from "./sync";

interface Row {
  id: string;
  updated_at: number;
  server_seq: number;
  deleted: number;
  data: string;
}

// Minimal in-memory D1: implements exactly the statements handleSync uses.
function fakeDb() {
  const articles = new Map<string, Row>();
  const settings = new Map<string, Row>();
  const normalize = (sql: string) => sql.replace(/\s+/g, " ").trim();

  function statement(sql: string): D1Statement {
    let args: unknown[] = [];
    const text = normalize(sql);
    const stmt: D1Statement = {
      bind(...values: unknown[]) {
        args = values;
        return stmt;
      },
      async first<T>() {
        if (text.startsWith("SELECT updated_at FROM articles")) {
          const row = articles.get(String(args[0]));
          return (row ? { updated_at: row.updated_at } : null) as T | null;
        }
        if (text.startsWith("SELECT updated_at FROM settings")) {
          const row = settings.get("settings");
          return (row ? { updated_at: row.updated_at } : null) as T | null;
        }
        if (text.startsWith("SELECT updated_at, data FROM settings")) {
          const row = settings.get("settings");
          return (row ? { updated_at: row.updated_at, data: row.data } : null) as T | null;
        }
        throw new Error(`unexpected first(): ${text}`);
      },
      async all<T>() {
        if (text.startsWith("SELECT id, updated_at, server_seq, deleted, data FROM articles")) {
          const since = Number(args[0]);
          const rows = [...articles.values()]
            .filter((row) => row.server_seq >= since)
            .sort((a, b) => a.server_seq - b.server_seq)
            .slice(0, 500);
          return { results: rows as T[] };
        }
        throw new Error(`unexpected all(): ${text}`);
      },
      async run() {
        if (text.startsWith("INSERT INTO articles")) {
          const [id, updatedAt, serverSeq, deleted, data] = args as [
            string,
            number,
            number,
            number,
            string,
          ];
          articles.set(id, {
            id,
            updated_at: updatedAt,
            server_seq: serverSeq,
            deleted,
            data,
          });
          return {};
        }
        if (text.startsWith("INSERT INTO settings")) {
          const [updatedAt, serverSeq, data] = args as [number, number, string];
          settings.set("settings", {
            id: "settings",
            updated_at: updatedAt,
            server_seq: serverSeq,
            deleted: 0,
            data,
          });
          return {};
        }
        throw new Error(`unexpected run(): ${text}`);
      },
    };
    return stmt;
  }

  return { prepare: statement, articles, settings } satisfies D1Like & {
    articles: Map<string, Row>;
    settings: Map<string, Row>;
  };
}

const makeEnv = (db: D1Like): Env => ({
  OPENCODE_API_KEY: "zen",
  APP_TOKEN: "app",
  BUDGET: { get: async () => null, put: async () => {} },
  ASSETS: { fetch: async () => new Response("shell") },
  ALLOWED_MODELS: "deepseek-v4.1-flash",
  DAILY_CHUNK_BUDGET: "200",
  DB: db,
});

const post = (body: unknown) =>
  new Request("https://app.example/api/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const row = (id: string, updatedAt: number, data = `{"id":"${id}"}`, deleted = false) => ({
  id,
  updatedAt,
  deleted,
  data,
});

describe("handleSync", () => {
  it("pushes a row and returns it on the next pull", async () => {
    const db = fakeDb();
    const first = await handleSync(
      post({ cursor: 0, articles: [row("a", 100)], settings: null }),
      makeEnv(db),
    );
    expect(first.status).toBe(200);
    const body = (await first.json()) as { cursor: number; articles: unknown[] };
    expect(body.articles).toHaveLength(1);
    expect(body.cursor).toBeGreaterThan(0);

    const second = await handleSync(
      post({ cursor: 0, articles: [], settings: null }),
      makeEnv(db),
    );
    const secondBody = (await second.json()) as { articles: Array<{ id: string }> };
    expect(secondBody.articles.map((a) => a.id)).toEqual(["a"]);
  });

  it("keeps the server version when an older edit is pushed (LWW)", async () => {
    const db = fakeDb();
    await handleSync(post({ cursor: 0, articles: [row("a", 200, '{"v":2}')], settings: null }), makeEnv(db));
    const response = await handleSync(
      post({ cursor: 0, articles: [row("a", 100, '{"v":1}')], settings: null }),
      makeEnv(db),
    );
    const body = (await response.json()) as { articles: Array<{ updatedAt: number; data: string }> };
    expect(body.articles[0]?.updatedAt).toBe(200);
    expect(body.articles[0]?.data).toBe('{"v":2}');
  });

  it("round-trips a tombstone", async () => {
    const db = fakeDb();
    await handleSync(post({ cursor: 0, articles: [row("a", 100)], settings: null }), makeEnv(db));
    await handleSync(post({ cursor: 0, articles: [row("a", 300, "", true)], settings: null }), makeEnv(db));
    const response = await handleSync(post({ cursor: 0, articles: [], settings: null }), makeEnv(db));
    const body = (await response.json()) as { articles: Array<{ id: string; deleted: boolean }> };
    expect(body.articles[0]).toMatchObject({ id: "a", deleted: true });
  });

  it("syncs settings with LWW", async () => {
    const db = fakeDb();
    await handleSync(
      post({ cursor: 0, articles: [], settings: { updatedAt: 5, data: '{"model":"x"}' } }),
      makeEnv(db),
    );
    const older = await handleSync(
      post({ cursor: 0, articles: [], settings: { updatedAt: 4, data: '{"model":"y"}' } }),
      makeEnv(db),
    );
    const body = (await older.json()) as { settings: { updatedAt: number; data: string } };
    expect(body.settings).toEqual({ updatedAt: 5, data: '{"model":"x"}' });
  });

  it("rejects malformed bodies and oversized batches", async () => {
    const db = fakeDb();
    const env = makeEnv(db);
    expect((await handleSync(post({ nope: true }), env)).status).toBe(400);
    expect(
      (await handleSync(post({ cursor: 0, articles: Array.from({ length: 11 }, (_, i) => row(`a${i}`, 1)), settings: null }), env)).status,
    ).toBe(400);
    expect(
      (await handleSync(post({ cursor: 0, articles: [row("big", 1, "x".repeat(1_000_001))], settings: null }), env)).status,
    ).toBe(400);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm vitest run worker/sync.test.ts`

Expected: FAIL — `Cannot find module './sync'`.

- [ ] **Step 4: Implement `worker/sync.ts`**

```ts
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

export async function handleSync(request: Request, env: Env): Promise<Response> {
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return jsonResponse({ error: "too large" }, 413);
  let parsed: SyncRequest | null = null;
  try {
    parsed = parseRequest(JSON.parse(raw));
  } catch {
    parsed = null;
  }
  if (!parsed) return jsonResponse({ error: "bad request" }, 400);

  const now = Date.now();

  for (const row of parsed.articles) {
    const stored = await env.DB.prepare(
      "SELECT updated_at FROM articles WHERE id = ?",
    )
      .bind(row.id)
      .first<{ updated_at: number }>();
    if (stored && row.updatedAt < stored.updated_at) continue;
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

  const articles = (pulled.results ?? []).map((row) => ({
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

function parseRequest(body: unknown): SyncRequest | null {
  if (typeof body !== "object" || body === null) return null;
  const record = body as Record<string, unknown>;
  const cursor =
    typeof record.cursor === "number" && Number.isFinite(record.cursor)
      ? Math.max(0, Math.floor(record.cursor))
      : 0;
  const rawArticles = Array.isArray(record.articles) ? record.articles : null;
  if (!rawArticles || rawArticles.length > MAX_ARTICLES_PER_REQUEST) return null;
  const articles: ArticleRow[] = [];
  for (const entry of rawArticles) {
    if (typeof entry !== "object" || entry === null) return null;
    const row = entry as Record<string, unknown>;
    if (typeof row.id !== "string" || row.id.length === 0 || row.id.length > 100) return null;
    if (typeof row.updatedAt !== "number" || !Number.isFinite(row.updatedAt)) return null;
    if (typeof row.deleted !== "boolean") return null;
    if (typeof row.data !== "string" || row.data.length > MAX_ROW_BYTES) return null;
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
    if (typeof row.updatedAt !== "number" || !Number.isFinite(row.updatedAt)) return null;
    if (typeof row.data !== "string" || row.data.length > MAX_ROW_BYTES) return null;
    settings = { updatedAt: row.updatedAt, data: row.data };
  }
  return { cursor, articles, settings };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm vitest run worker/sync.test.ts`

Expected: PASS (5 tests).

- [ ] **Step 6: Register the route**

In `worker/index.ts`, import `handleSync` and add before the 404 fallback:

```ts
  } else if (url.pathname === "/api/sync" && request.method === "POST") {
    response = await handleSync(request, env);
```

- [ ] **Step 7: Run all gates**

Run: `pnpm typecheck && pnpm lint && pnpm test`

Expected: all pass (existing worker tests included).

- [ ] **Step 8: Commit**

```bash
git add worker/sync.ts worker/sync.test.ts worker/env.ts worker/index.ts
git commit -m "feat(sync): /api/sync endpoint with LWW, tombstones and cursor"
```

---

### Task 3: Client store — dirty tracking, tombstones, remote apply

**Files:**
- Modify: `src/lib/types.ts`, `src/lib/store.ts`, `src/lib/store.test.ts`, `src/routes/ArticlePage.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces (used by Tasks 4–6):
  - `Article.dirty?: boolean`, `Article.deleted?: boolean`.
  - `ArticleStore.listAll(): Promise<Article[]>` — all rows including tombstones.
  - `ArticleStore.applyRemote(articles: Article[]): Promise<void>` — writes rows with `dirty: false`, no `updatedAt` bump, no change notification.
  - `createStore(dbName?: string, onChange?: () => void)` — `onChange` fires after `put`/`update`/`remove`.

- [ ] **Step 1: Extend the types**

In `src/lib/types.ts`, add to `Article`:

```ts
  /** Local changes not yet acknowledged by sync. */
  dirty?: boolean;
  /** Tombstone: deleted locally, kept so the deletion can sync. */
  deleted?: boolean;
```

- [ ] **Step 2: Write the failing store tests**

Append to `src/lib/store.test.ts`:

```ts
  it("marks writes dirty and keeps tombstones for removed rows", async () => {
    const store = await createStore(`test-${randomUUID()}`);
    const article = makeArticle();
    await store.put(article);
    expect((await store.get(article.id))?.dirty).toBe(true);

    await store.update(article.id, { status: "read" });
    expect((await store.get(article.id))?.dirty).toBe(true);

    await store.remove(article.id);
    expect(await store.get(article.id)).toBeUndefined();
    expect(await store.findByUrl(article.url ?? "")).toBeUndefined();
    expect((await store.list()).map((a) => a.id)).not.toContain(article.id);
    const all = await store.listAll();
    expect(all.find((a) => a.id === article.id)).toMatchObject({ deleted: true });
    store.close();
  });

  it("applies remote rows without dirtying them and reports local writes", async () => {
    const changes: number[] = [];
    const store = await createStore(`test-${randomUUID()}`, () => changes.push(1));
    const article = makeArticle({ dirty: true });
    await store.put(article);
    await store.applyRemote([{ ...article, dirty: false, title: "Remote" }]);
    expect((await store.get(article.id))?.dirty).toBe(false);
    expect((await store.get(article.id))?.title).toBe("Remote");
    expect(changes.length).toBe(1); // only put() notified
    store.close();
  });
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm vitest run src/lib/store.test.ts`

Expected: FAIL — `store.listAll is not a function` / `applyRemote is not a function`.

- [ ] **Step 4: Implement the store changes**

In `src/lib/store.ts`:

```ts
export interface ArticleStore {
  list(): Promise<Article[]>;
  listAll(): Promise<Article[]>;
  get(id: string): Promise<Article | undefined>;
  put(article: Article): Promise<void>;
  update(id: string, patch: Partial<Article>): Promise<Article>;
  remove(id: string): Promise<void>;
  findByUrl(url: string): Promise<Article | undefined>;
  applyRemote(articles: Article[]): Promise<void>;
  close(): void;
}

export async function createStore(
  dbName = "quiosco",
  onChange?: () => void,
): Promise<ArticleStore> {
```

and the returned methods:

```ts
    async list() {
      const all = await db.getAllFromIndex("articles", "createdAt");
      return all.filter((article) => !article.deleted).reverse();
    },
    async listAll() {
      return db.getAll("articles");
    },
    async get(id) {
      const article = await db.get("articles", id);
      return article && !article.deleted ? article : undefined;
    },
    async put(article) {
      await db.put("articles", { ...article, dirty: true });
      onChange?.();
    },
    async update(id, patch) {
      const existing = await db.get("articles", id);
      if (!existing) throw new Error(`article not found: ${id}`);
      const updated: Article = {
        ...existing,
        ...patch,
        dirty: true,
        updatedAt: Date.now(),
      };
      await db.put("articles", updated);
      onChange?.();
      return updated;
    },
    async remove(id) {
      const existing = await db.get("articles", id);
      if (!existing || existing.deleted) return;
      await db.put("articles", {
        ...existing,
        deleted: true,
        dirty: true,
        updatedAt: Date.now(),
      });
      onChange?.();
    },
    async findByUrl(url) {
      const matches = await db.getAllFromIndex("articles", "url", url);
      return matches.find((article) => !article.deleted);
    },
    async applyRemote(articles) {
      const tx = db.transaction("articles", "readwrite");
      for (const article of articles) {
        await tx.store.put({ ...article, dirty: false });
      }
      await tx.done;
    },
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm vitest run src/lib/store.test.ts`

Expected: PASS (all store tests).

- [ ] **Step 6: Handle a remotely deleted article on the article page**

In `src/routes/ArticlePage.tsx`, in the load effect, replace the guard so a missing row navigates away:

```ts
      const loaded = await store.get(id);
      if (cancelled) return;
      if (!loaded) {
        navigate("/", { replace: true });
        return;
      }
      setArticle(loaded);
```

and in the poll callback, after `const fresh = await store.get(id);`:

```ts
        if (!fresh) {
          navigate("/", { replace: true });
          return;
        }
```

- [ ] **Step 7: Run all gates**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm scan`

Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add src/lib/types.ts src/lib/store.ts src/lib/store.test.ts src/routes/ArticlePage.tsx
git commit -m "feat(sync): dirty tracking and tombstones in the article store"
```

---

### Task 4: Settings — `updatedAt` and dirty tracking

**Files:**
- Modify: `src/lib/types.ts`, `src/lib/settings.ts`, `src/lib/settings.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (used by Tasks 5–6):
  - `Settings.updatedAt?: number`.
  - `saveSettings(settings, storage?)` — stamps `updatedAt`, sets the dirty flag.
  - `isSettingsDirty(storage?): boolean`, `clearSettingsDirty(storage?): void`.
  - `applyRemoteSettings(remote: { updatedAt: number; data: string }, storage?): Settings | null` — LWW merge preserving `appToken`; returns the applied settings or null when not applied.
  - Storage shape: `Pick<Storage, "getItem" | "setItem" | "removeItem">`.

- [ ] **Step 1: Add `updatedAt` to the type**

In `src/lib/types.ts`, add to `Settings`:

```ts
  /** LWW clock for settings sync. */
  updatedAt?: number;
```

- [ ] **Step 2: Write the failing tests**

Append to `src/lib/settings.test.ts` (the file runs under `// @vitest-environment jsdom`, so it uses the real `localStorage`; extend the existing import line with `applyRemoteSettings`, `clearSettingsDirty` and `isSettingsDirty`):

```ts
  it("stamps updatedAt and marks dirty on save", () => {
    localStorage.clear();
    const before = Date.now();
    saveSettings({ ...DEFAULT_SETTINGS, model: "m" });
    const saved = loadSettings();
    expect(saved.updatedAt).toBeGreaterThanOrEqual(before);
    expect(isSettingsDirty()).toBe(true);
    clearSettingsDirty();
    expect(isSettingsDirty()).toBe(false);
  });

  it("applies newer remote settings, preserving the app token", () => {
    localStorage.clear();
    saveSettings({ ...DEFAULT_SETTINGS, appToken: "local-token", model: "old" });
    const applied = applyRemoteSettings({
      updatedAt: Date.now() + 1000,
      data: JSON.stringify({ model: "new", targetLanguage: "French" }),
    });
    expect(applied?.model).toBe("new");
    expect(applied?.targetLanguage).toBe("French");
    expect(loadSettings().appToken).toBe("local-token");
  });

  it("ignores older remote settings", () => {
    localStorage.clear();
    saveSettings({ ...DEFAULT_SETTINGS, model: "keep" });
    const local = loadSettings();
    expect(
      applyRemoteSettings({ updatedAt: 1, data: JSON.stringify({ model: "stale" }) }),
    ).toBeNull();
    expect(loadSettings().model).toBe(local.model);
  });
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm vitest run src/lib/settings.test.ts`

Expected: FAIL — `saveSettings` does not stamp / `isSettingsDirty is not a function`.

- [ ] **Step 4: Implement the settings changes**

In `src/lib/settings.ts`:

```ts
export const SETTINGS_KEY = "quiosco.settings.v1";
const SETTINGS_DIRTY_KEY = "quiosco.settings.dirty";
type SettingsStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function loadSettings(storage: Pick<Storage, "getItem"> = localStorage): Settings {
  // ...existing parsing, plus:
  // updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : 0,
}

export function saveSettings(settings: Settings, storage: SettingsStorage = localStorage): void {
  storage.setItem(
    SETTINGS_KEY,
    JSON.stringify({ ...settings, updatedAt: Date.now() }),
  );
  storage.setItem(SETTINGS_DIRTY_KEY, "1");
}

export function isSettingsDirty(storage: Pick<Storage, "getItem"> = localStorage): boolean {
  return storage.getItem(SETTINGS_DIRTY_KEY) === "1";
}

export function clearSettingsDirty(storage: Pick<Storage, "removeItem"> = localStorage): void {
  storage.removeItem(SETTINGS_DIRTY_KEY);
}

const SYNCED_FIELDS = ["targetLanguage", "rules", "model", "autoTranslate"] as const;

export function applyRemoteSettings(
  remote: { updatedAt: number; data: string },
  storage: SettingsStorage = localStorage,
): Settings | null {
  const current = loadSettings(storage);
  if (remote.updatedAt < (current.updatedAt ?? 0)) return null;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(remote.data) as Record<string, unknown>;
  } catch {
    return null;
  }
  const next: Settings = { ...current, updatedAt: remote.updatedAt };
  for (const field of SYNCED_FIELDS) {
    const value = parsed[field];
    if (field === "autoTranslate") {
      if (typeof value === "boolean") next.autoTranslate = value;
    } else if (typeof value === "string") {
      next[field] = value;
    }
  }
  storage.setItem(SETTINGS_KEY, JSON.stringify(next));
  return next;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm vitest run src/lib/settings.test.ts`

Expected: PASS.

- [ ] **Step 6: Run all gates and commit**

Run: `pnpm typecheck && pnpm lint && pnpm test`

```bash
git add src/lib/types.ts src/lib/settings.ts src/lib/settings.test.ts
git commit -m "feat(sync): settings updatedAt, dirty flag and remote apply"
```

---

### Task 5: Client sync engine

**Files:**
- Modify: `src/lib/types.ts` (sync payload types), `src/lib/api.ts` (+ `sync`), `src/lib/api.test.ts`
- Create: `src/lib/sync.ts`, `src/lib/sync.test.ts`

**Interfaces:**
- Consumes: `ArticleStore` (Task 3), settings helpers (Task 4), `ApiClient` (`createApi`).
- Produces (used by Task 6):
  - `SyncArticleRow`, `SyncSettingsRow`, `SyncRequest`, `SyncResponse` in `src/lib/types.ts`.
  - `ApiClient.sync(request: SyncRequest): Promise<SyncResponse>`.
  - `syncNow(store, settings, api, storage?): Promise<SyncSummary>` where `SyncSummary = { pushed: number; pulled: number }`.
  - `registerSyncRunner(fn: () => Promise<SyncSummary | null>)`, `scheduleSync(delayMs?)`, `runSyncNow(): Promise<SyncSummary | null>` — module-level trigger plumbing.
  - localStorage keys: `quiosco.sync.cursor`, `quiosco.sync.at`.
  - DOM event `quiosco:sync` after applying remote changes.

- [ ] **Step 1: Add the payload types**

In `src/lib/types.ts`:

```ts
export interface SyncArticleRow {
  id: string;
  updatedAt: number;
  deleted: boolean;
  data: string;
}

export interface SyncSettingsRow {
  updatedAt: number;
  data: string;
}

export interface SyncRequest {
  cursor: number;
  articles: SyncArticleRow[];
  settings: SyncSettingsRow | null;
}

export interface SyncResponse {
  cursor: number;
  articles: SyncArticleRow[];
  settings: SyncSettingsRow | null;
}
```

- [ ] **Step 2: Write the failing api test**

Append to `src/lib/api.test.ts`:

```ts
  it("posts a sync request and parses the response", async () => {
    const payload = {
      cursor: 7,
      articles: [{ id: "a", updatedAt: 1, deleted: false, data: "{}" }],
      settings: null,
    };
    const response = { cursor: 9, articles: [], settings: null };
    const fetchFn = vi.fn(
      async () =>
        new Response(JSON.stringify(response), {
          headers: { "content-type": "application/json" },
        }),
    );
    const api = createApi({ token: "t", fetchFn: fetchFn as unknown as typeof fetch });
    await expect(api.sync(payload)).resolves.toEqual(response);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/sync");
    expect(JSON.parse(String(init.body))).toEqual(payload);
  });
```

- [ ] **Step 3: Implement `api.sync`**

In `src/lib/api.ts`: add `sync(request: SyncRequest): Promise<SyncResponse>` to `ApiClient`, import the types, and in the returned object:

```ts
    async sync(request) {
      const response = await ensureOk(
        await fetchFn("/api/sync", {
          method: "POST",
          headers: { ...authHeaders, "Content-Type": "application/json" },
          body: JSON.stringify(request),
          signal: AbortSignal.timeout(CLIENT_TIMEOUT_MS),
        }),
      );
      return (await response.json()) as SyncResponse;
    },
```

Run: `pnpm vitest run src/lib/api.test.ts` — Expected: PASS.

- [ ] **Step 4: Write the failing sync engine tests**

Create `src/lib/sync.test.ts`:

```ts
import "fake-indexeddb/auto";
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "./api";
import { createStore } from "./store";
import { syncNow } from "./sync";
import type { Article, Settings, SyncRequest, SyncResponse } from "./types";

function fakeStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
  };
}

const settings: Settings = {
  targetLanguage: "English",
  rules: "",
  model: "m",
  appToken: "t",
  autoTranslate: true,
  updatedAt: 10,
};

const makeArticle = (patch: Partial<Article> = {}): Article => ({
  id: randomUUID(),
  url: null,
  title: "Título",
  site: null,
  text: "texto",
  via: "manual",
  translation: null,
  translationStatus: "pending",
  translatedChunks: 0,
  totalChunks: 0,
  status: "unread",
  error: null,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  ...patch,
});

const fakeApi = (handler: (request: SyncRequest) => SyncResponse) =>
  ({ sync: vi.fn(async (request: SyncRequest) => handler(request)) }) as unknown as ApiClient;

describe("syncNow", () => {
  it("pushes dirty rows and clears dirty from the echo", async () => {
    const store = await createStore(`test-${randomUUID()}`);
    const article = makeArticle();
    await store.put(article);
    const seen: SyncRequest[] = [];
    const api = fakeApi((request) => {
      seen.push(request);
      return {
        cursor: 5,
        articles: request.articles.map((row) => ({ ...row })),
        settings: null,
      };
    });
    const summary = await syncNow(store, settings, api, fakeStorage());
    expect(summary.pushed).toBe(1);
    expect(seen[0]?.articles[0]?.id).toBe(article.id);
    expect((await store.listAll())[0]?.dirty).toBe(false);
    store.close();
  });

  it("applies remote rows, keeps newer local edits and dispatches an event", async () => {
    const store = await createStore(`test-${randomUUID()}`);
    const local = makeArticle({ updatedAt: 100 });
    await store.put(local);
    const remoteNewer = { ...local, updatedAt: 200, title: "Remote", dirty: false };
    const remoteOlder = makeArticle({ updatedAt: 50 });
    const events: number[] = [];
    vi.stubGlobal("window", { dispatchEvent: () => events.push(1) });
    const api = fakeApi(() => ({
      cursor: 9,
      articles: [
        { id: remoteNewer.id, updatedAt: 200, deleted: false, data: JSON.stringify(remoteNewer) },
        { id: remoteOlder.id, updatedAt: 50, deleted: false, data: JSON.stringify(remoteOlder) },
      ],
      settings: null,
    }));
    await syncNow(store, settings, api, fakeStorage());
    expect((await store.get(local.id))?.title).toBe("Remote");
    expect((await store.get(remoteOlder.id))?.dirty).toBe(false);
    expect(events.length).toBe(1);
    vi.unstubAllGlobals();
    store.close();
  });

  it("persists the cursor and applies remote settings", async () => {
    const store = await createStore(`test-${randomUUID()}`);
    const storage = fakeStorage();
    const api = fakeApi(() => ({
      cursor: 42,
      articles: [],
      settings: { updatedAt: 99, data: JSON.stringify({ model: "remote-model" }) },
    }));
    await syncNow(store, settings, api, storage);
    expect(storage.getItem("quiosco.sync.cursor")).toBe("42");
    expect(JSON.parse(storage.getItem("quiosco.settings.v1") ?? "{}").model).toBe("remote-model");
    store.close();
  });

  it("splits large dirty queues into batches", async () => {
    const store = await createStore(`test-${randomUUID()}`);
    for (let index = 0; index < 12; index += 1) {
      await store.put(makeArticle());
    }
    const batches: number[] = [];
    const api = fakeApi((request) => {
      batches.push(request.articles.length);
      return { cursor: 1, articles: [], settings: null };
    });
    await syncNow(store, settings, api, fakeStorage());
    expect(batches).toEqual([10, 2]);
    store.close();
  });
});
```

- [ ] **Step 5: Run the tests to verify they fail**

Run: `pnpm vitest run src/lib/sync.test.ts`

Expected: FAIL — `Cannot find module './sync'`.

- [ ] **Step 6: Implement `src/lib/sync.ts`**

```ts
import type { ApiClient } from "./api";
import {
  applyRemoteSettings,
  clearSettingsDirty,
  isSettingsDirty,
} from "./settings";
import type { ArticleStore } from "./store";
import type { Article, Settings, SyncArticleRow, SyncRequest, SyncResponse } from "./types";

const CURSOR_KEY = "quiosco.sync.cursor";
const LAST_SYNC_KEY = "quiosco.sync.at";
const MAX_BATCH_ROWS = 10;
const MAX_BATCH_BYTES = 2_000_000;
const PAGE_SIZE = 500;

export interface SyncSummary {
  pushed: number;
  pulled: number;
}

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export async function syncNow(
  store: ArticleStore,
  settings: Settings,
  api: ApiClient,
  storage: StorageLike = localStorage,
): Promise<SyncSummary> {
  let cursor = Number(storage.getItem(CURSOR_KEY) ?? "0") || 0;
  const all = await store.listAll();
  const dirty = all.filter((article) => article.dirty);
  const batches = batchRows(dirty);
  let settingsRow =
    isSettingsDirty(storage) && settings.updatedAt
      ? { updatedAt: settings.updatedAt, data: serializeSettings(settings) }
      : null;

  let pushed = 0;
  let pulled = 0;
  let lastCount = 0;
  const requests = batches.length > 0 ? batches : [[]];
  for (const batch of requests) {
    const response = await api.sync({
      cursor,
      articles: batch.map(toRow),
      settings: settingsRow,
    });
    settingsRow = null;
    pushed += batch.length;
    pulled += response.articles.length;
    lastCount = response.articles.length;
    cursor = response.cursor;
    await applyResponse(store, storage, response);
  }
  while (lastCount === PAGE_SIZE) {
    const response = await api.sync({ cursor, articles: [], settings: null });
    pulled += response.articles.length;
    lastCount = response.articles.length;
    cursor = response.cursor;
    await applyResponse(store, storage, response);
  }
  storage.setItem(CURSOR_KEY, String(cursor));
  storage.setItem(LAST_SYNC_KEY, String(Date.now()));
  return { pushed, pulled };
}

async function applyResponse(
  store: ArticleStore,
  storage: StorageLike,
  response: SyncResponse,
): Promise<void> {
  if (response.articles.length > 0) {
    const localById = new Map(
      (await store.listAll()).map((article) => [article.id, article]),
    );
    const toApply: Article[] = [];
    for (const row of response.articles) {
      let parsed: Article;
      try {
        parsed = JSON.parse(row.data) as Article;
      } catch {
        continue;
      }
      const local = localById.get(row.id);
      if (local?.dirty && local.updatedAt > row.updatedAt) continue;
      toApply.push({
        ...parsed,
        id: row.id,
        updatedAt: row.updatedAt,
        deleted: row.deleted,
        dirty: false,
      });
    }
    if (toApply.length > 0) {
      await store.applyRemote(toApply);
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("quiosco:sync"));
      }
    }
  }
  if (response.settings) {
    const applied = applyRemoteSettings(response.settings, storage);
    if (applied) clearSettingsDirty(storage);
  }
}

function batchRows(rows: Article[]): Article[][] {
  const batches: Article[][] = [];
  let current: Article[] = [];
  let bytes = 0;
  for (const row of rows) {
    const size = JSON.stringify(row).length;
    if (current.length >= MAX_BATCH_ROWS || bytes + size > MAX_BATCH_BYTES) {
      if (current.length > 0) batches.push(current);
      current = [];
      bytes = 0;
    }
    current.push(row);
    bytes += size;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

function toRow(article: Article): SyncArticleRow {
  return {
    id: article.id,
    updatedAt: article.updatedAt,
    deleted: article.deleted === true,
    data: JSON.stringify(article),
  };
}

function serializeSettings(settings: Settings): string {
  return JSON.stringify({
    targetLanguage: settings.targetLanguage,
    rules: settings.rules,
    model: settings.model,
    autoTranslate: settings.autoTranslate,
  });
}

// Trigger plumbing: App registers a runner; pages call scheduleSync().
let runner: (() => Promise<SyncSummary | null>) | null = null;
let timer: number | null = null;

export function registerSyncRunner(fn: () => Promise<SyncSummary | null>): void {
  runner = fn;
}

export function scheduleSync(delayMs = 3000): void {
  if (typeof window === "undefined") return;
  if (timer !== null) window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    timer = null;
    void runSyncNow().catch(() => undefined);
  }, delayMs);
}

export function runSyncNow(): Promise<SyncSummary | null> {
  return runner ? runner() : Promise.resolve(null);
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm vitest run src/lib/sync.test.ts src/lib/api.test.ts`

Expected: PASS.

- [ ] **Step 8: Run all gates and commit**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm scan`

```bash
git add src/lib/sync.ts src/lib/sync.test.ts src/lib/api.ts src/lib/api.test.ts src/lib/types.ts
git commit -m "feat(sync): client sync engine with batching, LWW merge and triggers"
```

---

### Task 6: UI wiring, refresh events, and e2e

**Files:**
- Modify: `src/lib/useStore.ts`, `src/App.tsx`, `src/routes/SettingsPage.tsx`, `src/routes/ListPage.tsx`, `src/routes/ArticlePage.tsx`, `src/styles.css`, `e2e/app.spec.ts`, `playwright.config.ts`

**Interfaces:**
- Consumes: `syncNow`, `registerSyncRunner`, `scheduleSync`, `runSyncNow`, `getStore`, `loadSettings`, `createApi`, `formatDateTime`.
- Produces: automatic sync (mount, `online`, debounced after writes), a Settings sync block with last-sync time and a "Sync now" button, and pages that refresh on `quiosco:sync`.

- [ ] **Step 1: Wire store changes to the sync scheduler**

In `src/lib/useStore.ts`:

```ts
import { scheduleSync } from "./sync";
// ...
  storePromise ??= createStore("quiosco", () => scheduleSync());
```

- [ ] **Step 2: Register the runner and trigger sync on mount**

In `src/App.tsx`:

```tsx
import { useEffect } from "react";
import { createApi } from "./lib/api";
import { loadSettings } from "./lib/settings";
import { registerSyncRunner, scheduleSync, syncNow } from "./lib/sync";
import { getStore } from "./lib/useStore";
// ...
export default function App() {
  useEffect(() => {
    registerSyncRunner(async () => {
      const settings = loadSettings();
      if (!settings.appToken) return null;
      const store = await getStore();
      const api = createApi({ token: settings.appToken });
      return syncNow(store, settings, api);
    });
    const onOnline = () => scheduleSync(0);
    window.addEventListener("online", onOnline);
    scheduleSync(0);
    return () => window.removeEventListener("online", onOnline);
  }, []);
```

- [ ] **Step 3: Add the Settings sync block**

In `src/routes/SettingsPage.tsx`, add state and handler:

```tsx
  const [syncState, setSyncState] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState(
    () => Number(localStorage.getItem("quiosco.sync.at") ?? "0") || 0,
  );

  async function onSyncNow() {
    setSyncState("Syncing…");
    try {
      const summary = await runSyncNow();
      setLastSync(Number(localStorage.getItem("quiosco.sync.at") ?? "0") || 0);
      setSyncState(
        summary
          ? `Synced — ${summary.pushed} up, ${summary.pulled} down`
          : "Set the app token first",
      );
    } catch (error) {
      setSyncState(error instanceof Error ? error.message : "Sync failed");
    }
  }
```

and in the JSX after the row with Save/Check connection:

```tsx
      <div className="row">
        <button type="button" onClick={onSyncNow}>
          Sync now
        </button>
        <span className="muted">
          {lastSync > 0 ? `Last sync: ${formatDateTime(lastSync)}` : "Never synced"}
        </span>
      </div>
      {syncState && <p className="muted">{syncState}</p>}
```

(Import `runSyncNow` and `formatDateTime`.)

- [ ] **Step 4: Refresh pages on remote changes**

In `src/routes/ListPage.tsx`, extend the load effect:

```tsx
  useEffect(() => {
    if (!store) return;
    let cancelled = false;
    const reload = () => {
      void store.list().then((all) => {
        if (!cancelled) setArticles(all);
      });
    };
    reload();
    window.addEventListener("quiosco:sync", reload);
    return () => {
      cancelled = true;
      window.removeEventListener("quiosco:sync", reload);
    };
  }, [store]);
```

In `src/routes/ArticlePage.tsx`, add an effect that re-reads the article (and navigates away if it is gone):

```tsx
  useEffect(() => {
    if (!store || !id) return;
    const reload = () => {
      void (async () => {
        const fresh = await store.get(id);
        if (!fresh) {
          navigate("/", { replace: true });
          return;
        }
        setArticle(fresh);
      })();
    };
    window.addEventListener("quiosco:sync", reload);
    return () => window.removeEventListener("quiosco:sync", reload);
  }, [store, id, navigate]);
```

In `src/routes/SettingsPage.tsx`, refresh the form when remote settings land
(the file already holds them in `const [settings, setSettings] =
useState<Settings>(() => loadSettings())`; add `useEffect` to the React import):

```tsx
  useEffect(() => {
    const reload = () => setSettings(loadSettings());
    window.addEventListener("quiosco:sync", reload);
    return () => window.removeEventListener("quiosco:sync", reload);
  }, []);
```

- [ ] **Step 5: Migrate the local D1 before e2e and write the sync e2e test**

In `playwright.config.ts`, extend the webServer command:

```
"pnpm build && pnpm exec wrangler d1 execute quiosco --local --file worker/migrations/0001_sync.sql && pnpm exec wrangler dev --port 8787 --var APP_TOKEN:e2e-token --var OPENCODE_API_KEY:e2e-zen --var ALLOWED_MODELS:deepseek-v4.1-flash --var DAILY_CHUNK_BUDGET:200"
```

Append to `e2e/app.spec.ts`:

```ts
test("syncs an article between two devices", async ({ browser }) => {
  const title = `Prueba sync ${Date.now()}`;
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  for (const page of [pageA, pageB]) {
    await page.goto("/settings");
    await page.getByLabel("App token").fill("e2e-token");
    await page.getByLabel("Translate automatically after saving").uncheck();
    await page.getByRole("button", { name: "Save" }).click();
  }

  await pageA.goto("/add");
  await pageA.getByLabel("Title").fill(title);
  await pageA.getByLabel("Article text").fill(
    "Primer párrafo de prueba con la longitud mínima necesaria para guardar el artículo.\n\nSegundo párrafo del artículo de prueba.",
  );
  await pageA.getByRole("button", { name: "Save & translate" }).click();
  await pageA.waitForURL("**/article/**");

  await pageA.goto("/settings");
  await pageA.getByRole("button", { name: "Sync now" }).click();
  await expect(pageA.getByText(/Synced —/)).toBeVisible();

  await pageB.goto("/settings");
  await pageB.getByRole("button", { name: "Sync now" }).click();
  await expect(pageB.getByText(/Synced —/)).toBeVisible();
  await pageB.goto("/");
  await expect(pageB.getByRole("link", { name: new RegExp(title) })).toBeVisible();

  await contextA.close();
  await contextB.close();
});
```

- [ ] **Step 6: Run the gates**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm scan && pnpm e2e`

Expected: all pass; the new e2e sync test passes.

- [ ] **Step 7: Commit**

```bash
git add src/lib/useStore.ts src/App.tsx src/routes/SettingsPage.tsx src/routes/ListPage.tsx src/routes/ArticlePage.tsx src/styles.css e2e/app.spec.ts playwright.config.ts
git commit -m "feat(sync): automatic triggers, settings sync UI and two-device e2e"
```

---

### Task 7: Remote migration, deploy, and live verification

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: everything above.
- Produces: the deployed, working sync feature and documented operations.

- [ ] **Step 1: Apply the migration remotely**

Run: `pnpm exec wrangler d1 execute quiosco --remote --file worker/migrations/0001_sync.sql`

Expected: `Executed … queries` with no error.

- [ ] **Step 2: Update the README**

In the deployment checklist section, add:

```markdown
### Sync (D1)

1. `pnpm exec wrangler d1 create quiosco` (once) — the API token needs the D1
   permission; paste the returned `database_id` into `wrangler.toml`.
2. Apply the schema: `pnpm exec wrangler d1 execute quiosco --remote --file worker/migrations/0001_sync.sql`.
3. Deploy as usual (`pnpm deploy`).
4. On each device: Settings → App token → Save → "Sync now".
   The app also syncs on open, after local changes, and when the network returns.
```

- [ ] **Step 3: Deploy and verify the endpoint**

Run:

```bash
pnpm deploy
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://quiosco.alex-just.workers.dev/api/sync
```

Expected: deploy succeeds; the unauthenticated call returns `401`.

- [ ] **Step 4: Live round-trip with the real token**

Run (the token comes from the gitignored file; nothing is printed):

```bash
TOKEN=$(cat .superpowers/deploy-app-token.txt)
curl -s -X POST https://quiosco.alex-just.workers.dev/api/sync \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"cursor":0,"articles":[{"id":"probe","updatedAt":1,"deleted":false,"data":"{\"id\":\"probe\"}"}],"settings":null}' \
  | head -c 300
```

Expected: `200` with a JSON body containing the `probe` row and a `cursor`.

- [ ] **Step 5: User acceptance**

Ask the user to open the app on the phone and a desktop browser, enter the same app token, and hit "Sync now" on both — the same articles should appear on both, and marking one read on the phone should appear on the desktop after a sync.

- [ ] **Step 6: Commit**

```bash
git add README.md
git commit -m "docs: D1 sync deployment steps"
```

---

## Notes for the executor

- The D1 permission prerequisite (Task 1, Step 2) may require the user; if the
  command fails with an auth error, stop and ask instead of working around it.
- Never print the app token; use the gitignored file or a shell variable.
- The e2e worker uses a local D1 file under `.wrangler/state`; the migration is
  idempotent, so re-running it is safe.
- Keep the client bundle free of server-only names (`pnpm scan`).
