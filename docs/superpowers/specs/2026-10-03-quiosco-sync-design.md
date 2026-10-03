# Quiosco — Multi-device sync (Design)

Date: 2026-10-03
Status: draft for review

Supersedes two non-goals of `2026-09-30-quiosco-design.md`: "No accounts, sync,
or multi-user support" and "No server-side article storage". Everything else in
the original spec still holds.

## 1. Summary

Sync articles and settings across the user's devices through a small
server-side store in **Cloudflare D1** (managed SQLite). The app stays
local-first: IndexedDB remains the working store, every feature works offline,
and sync is opportunistic — on app open, after local writes, on regaining
connectivity, and via a manual "Sync now".

## 2. Goals / non-goals

Goals:

- G1 Same articles on all devices: text, translation, title, flags, timestamps.
- G2 Settings sync: target language, rules, model, auto-translate.
- G3 Offline-first: no UX or data-flow change while offline.
- G4 Nothing is lost: last-write-wins per row; deletions propagate.
- G5 Zero infra cost: D1 free tier, no new services.
- G6 Small, idiomatic, tested — same standards as the rest of the repo.

Non-goals:

- Real-time sync or push notifications (sync is on open / after writes / manual).
- Multi-user support or accounts (single user, single token).
- Syncing the app token (see §6).
- Purging tombstones, or history/undo beyond last-write-wins.

## 3. Storage (D1)

One database (`quiosco`), two tables:

```sql
CREATE TABLE IF NOT EXISTS articles (
  id TEXT PRIMARY KEY,
  updated_at INTEGER NOT NULL,   -- client updatedAt (ms), the LWW clock
  server_seq INTEGER NOT NULL,   -- server ms clock at write, the pull cursor
  deleted INTEGER NOT NULL DEFAULT 0,  -- tombstone
  data TEXT NOT NULL             -- article JSON as stored on the client
);
CREATE INDEX IF NOT EXISTS idx_articles_server_seq ON articles(server_seq);

CREATE TABLE IF NOT EXISTS settings (
  id TEXT PRIMARY KEY,           -- always 'settings'
  updated_at INTEGER NOT NULL,
  server_seq INTEGER NOT NULL,
  data TEXT NOT NULL             -- synced settings JSON
);
```

- `data` is opaque JSON so article fields can evolve without migrations.
- Size: article text is capped at 150k chars by the client, so a row stays far
  below D1's 2 MB row limit.
- `server_seq` is assigned by the server; the pull cursor never depends on a
  device clock.
- Free tier (5M row reads/day, 100k writes/day, 5 GB) is a rounding error for
  a personal library.

## 4. Protocol

One endpoint: `POST /api/sync`, behind the same bearer auth and Origin rules as
every other `/api/*` route.

Request:

```json
{
  "cursor": 0,
  "articles": [
    { "id": "…", "updatedAt": 1791, "deleted": false, "data": "{…}" }
  ],
  "settings": { "updatedAt": 1791, "data": "{…}" } | null
}
```

Response:

```json
{
  "cursor": 456,
  "articles": [ { "id": "…", "updatedAt": …, "deleted": …, "data": "{…}" } ],
  "settings": { "updatedAt": …, "data": "{…}" } | null
}
```

Rules:

- **Push (LWW)**: for each incoming row, read the stored row; accept when
  `incoming.updatedAt >= stored.updated_at`, then stamp `server_seq = now`.
  A rejected row is returned in the response unchanged, so a device that
  pushed a stale edit converges in the same round trip.
- **Pull**: rows with `server_seq >= cursor` ordered by `server_seq`, up to
  500 per response. The client repeats the request with the new cursor while a
  full page arrives. Inclusive comparison plus idempotent merges makes
  same-millisecond ties harmless.
- **Response contents**: the union of (a) the rows touched by this request's
  push — accepted rows with their new `server_seq`, rejected rows with the
  server's stored version — and (b) the pulled rows, deduplicated by id. The
  pushing device therefore converges in a single round trip.
- **Settings**: same LWW on the single row.
- **Caps**: request body ≤ 4 MB (413 on violation); ≤ 10 article rows per
  request; per-row `data` ≤ 1 MB (400 on violation). The client batches by
  size (≤ 2 MB per request, measured on the encoded row body) and count
  (≤ 10), looping until its dirty queue is drained.
- Worker invocation budget: ≤ ~35 D1 queries per request, inside the free
  tier's 50-query-per-invocation limit.

## 5. Client

### 5.1 Data model

`Article` gains two optional fields:

- `dirty?: boolean` — local changes not yet acknowledged by the server.
- `deleted?: boolean` — tombstone (replaces hard deletion).

`Settings` gains `updatedAt?: number`.

### 5.2 Store changes (`src/lib/store.ts`)

- `put()` / `update()` set `dirty: true` automatically.
- `remove(id)` writes a tombstone (`deleted: true, dirty: true,
  updatedAt: now`) instead of deleting the row.
- `list()` and `findByUrl()` exclude tombstones; `get(id)` returns `undefined`
  for them (the article page navigates back to the list when it disappears).
- New for sync: `listAll()` (all rows including tombstones) and
  `applyRemote(rows)` (write rows with `dirty: false`).

### 5.3 Sync engine (`src/lib/sync.ts`)

`syncNow(store, settings)`:

1. Read the cursor from localStorage (`quiosco.sync.cursor`, default 0).
2. Collect dirty articles (`listAll().filter((article) => article.dirty !== false)`
   — rows written before sync shipped have no flag and count as dirty once) and
   dirty settings.
3. Push in batches (≤ 10 rows / ≤ 2 MB per request) until drained; per batch,
   apply the response (below) and clear `dirty` for acknowledged rows.
4. Pull loop until a short page arrives.
5. Persist the cursor; return `{ pushed, pulled }` for the UI.

Merge per incoming row:

- No local row → insert with `dirty: false`.
- Local row dirty and `local.updatedAt > incoming.updatedAt` → keep local
  (it pushes next round).
- Otherwise (including equal timestamps — the accepted-push echo) → overwrite
  with the incoming row and clear `dirty`.

Settings merge: apply the incoming settings when
`incoming.updatedAt >= local.updatedAt` (an equal timestamp is the
accepted-push echo), then clear the local dirty flag; otherwise keep local.
The local `appToken` is always preserved.

### 5.4 Triggers and UI

- App mount (when a token exists), `online` events, and a 3-second debounce
  after local writes (`scheduleSync()` exported for pages).
- Settings gains a Sync block: last-sync time, "Sync now" button, inline
  status/error. The Settings screen is also where the token lives, so a new
  device is: enter token → sync.
- After a sync that changed data, `window.dispatchEvent(new
  Event("quiosco:sync"))`; the list and article pages re-read on that event.

## 6. Settings sync

- Synced: `targetLanguage`, `rules`, `model`, `autoTranslate`, `updatedAt`.
- Not synced: `appToken` — it is the credential itself (a new device must type
  it once anyway, since sync itself needs it), and syncing credentials is a
  needless risk.
- `saveSettings` stamps `updatedAt` and sets a dirty flag
  (`quiosco.settings.dirty`); sync clears it. A remote echo with an equal
  `updatedAt` applies and clears the flag, so the pushing device converges in
  the same round trip.

## 7. Edge cases and accepted limitations

- **Clock skew**: LWW uses device clocks; the user's devices are NTP-synced,
  so skew is negligible. Accepted, documented.
- **A translation running on device A** is visible on device B (progress rows
  sync). If A's run dies, the existing 10-minute stale-run recovery on either
  device flips it to the resumable error state and that state syncs back —
  consistent on both.
- **Deletions** propagate as tombstones; no purge in v1 (rows are tiny).
- **Offline**: dirty rows accumulate; the next sync drains them. Sync never
  wipes local data — merges only.
- **First sync of a large library**: batched push; failure mid-way leaves the
  remaining rows dirty for the next attempt.

## 8. Security and privacy

- `/api/sync` requires `Authorization: Bearer <APP_TOKEN>` and rejects
  cross-origin `Origin` headers, exactly like other `/api/*` routes.
- Server-side data is article text, translations and the synced settings —
  requested by the user. No other metadata, no analytics, no request-body
  logging (consistent with the existing Worker policy).
- The Zen key is not involved. The app token is never synced. D1 is reachable
  only through the Worker binding.

## 9. Testing and acceptance

- **Worker** (`worker/sync.test.ts`): LWW accept/reject, tombstone round-trip,
  cursor pagination, settings row, body/row caps, batched writes — against an
  injected in-memory D1 fake (the LWW decision lives in TypeScript, not in SQL,
  so it is testable).
- **Client** (`src/lib/sync.test.ts`): the merge matrix (new / local-newer /
  local-clean), tombstone propagation, cursor persistence, batching, settings
  LWW and dirty clearing; store tests for `remove()` tombstones and the
  tombstone-filtered reads.
- **E2E**: two browser contexts against the local worker with a local D1 —
  add on A, sync, sync on B, article appears; delete on B, sync, gone on A.
- **Live acceptance**: the user syncs the phone and a desktop browser and sees
  the same list.
- CI gates unchanged (typecheck, lint, tests, build, bundle scan, weekly
  smoke).

## 10. Deployment and operations

- `wrangler d1 create quiosco` → `[[d1_databases]] binding = "DB"` in
  `wrangler.toml`.
- Migration file `worker/migrations/0001_sync.sql`; applied with
  `wrangler d1 execute quiosco --remote --file …` (and `--local` for dev/e2e).
- **Prerequisite**: the Cloudflare API token needs D1 permissions (or run
  `wrangler login`); the current token cannot reach D1.
- README deploy checklist gains the D1 steps.
- Cost: $0 (free tier).

## 11. Risks

| Risk | Mitigation |
|---|---|
| Clock skew merges an older edit as newer | accepted LWW policy; negligible for one user's synced devices |
| Big first push fails part-way | batched, idempotent, rows stay dirty for retry |
| D1 limits (row/body/queries per invocation) | 150k-char article cap; client batches ≤2 MB / ≤10 rows; server caps 4 MB; ≤ ~35 queries per request |
| A deleted article resurrects | tombstones |
| Sync loop from a bad clock | cursor is server-assigned; merges idempotent |

## 12. Decisions resolved

- Storage: **D1** (chosen over KV — no queries — and Durable Objects —
  overkill).
- Local-first: IndexedDB stays the working store; sync is opportunistic.
- Conflicts: last-write-wins per row by `updatedAt`; deletions via tombstones.
- Settings sync excludes the app token.
- One endpoint (`/api/sync`); cursor = server-assigned `server_seq`.
