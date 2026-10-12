# Quiosco

[![Maintainability](https://qlty.sh/badges/53a72b39-2838-49ea-b4ca-ecad2b1ce54e/maintainability.svg)](https://qlty.sh/gh/Alex-Just/projects/quiosco)

Personal Android-first PWA: share an article URL (or manually extracted article
text) from the Android share sheet, and Quiosco extracts the text, translates it
via OpenCode Zen with your custom prompt, and keeps it in a local
read/unread/archived list with copy-to-clipboard.

## Architecture

- **PWA** (React + Vite + vite-plugin-pwa) — extraction (DOMParser +
  Readability), 5-rung fetch ladder orchestration, IndexedDB storage, UI.
- **Cloudflare Worker** — serves the built PWA and a thin authenticated proxy:
  `/api/fetch` (rung passthrough), `/api/translate` (Zen), `/api/sync`
  (multi-device sync), `/api/health`.
- **Storage** — IndexedDB on each device (offline-first), synced across your
  devices through Cloudflare D1 (`/api/sync`). See "Sync (D1)" below.

## Books

Import an `.epub` from the Add page (**Type: Book**). Quiosco parses it on the
device and keeps its chapters as text; the `.epub` file itself is not stored.

Books share the library, actions, and read/unread/archived states with
articles, but they are **local-only**: they never enter `/api/sync`, and
reading position stays local, exactly as it does for articles.

A book opens in Zen. Translation mode is a Zen-only toggle, off at every open:
when on, it translates the current paragraph sentence by sentence, prefetches
the pages ahead, and spends from the same Zen daily budget as articles.

Every translated sentence is cached permanently, keyed by content — the cache
is shared across books, so a sentence is never translated twice. The importer
adds a single runtime dependency: `fflate` (EPUB unzip).

## Development

```bash
pnpm install
cp .dev.vars.example .dev.vars   # fill in APP_TOKEN and OPENCODE_API_KEY
cp wrangler.toml wrangler.local.toml   # then paste your KV/D1 ids (gitignored)
pnpm dev                          # vite + wrangler dev (same-origin /api proxy)
pnpm test                         # unit tests
pnpm typecheck && pnpm lint
pnpm e2e                          # playwright (builds + runs wrangler dev)
pnpm smoke                        # against a deployed instance (see below)
```

`wrangler.toml` ships with zeroed placeholder resource ids so forks do not
advertise someone else's Cloudflare bindings. Put your real KV namespace id and
D1 `database_id` in gitignored `wrangler.local.toml` (the `pnpm` scripts prefer
that file when it exists).

This repository tracks hooks in `.githooks/`. Enable them in your clone once:

```bash
git config core.hooksPath .githooks
```

`pre-push` runs the Qlty quality check on the commits being pushed and blocks
the push when new issues appear. It is a guardrail, not a guarantee:
`--no-verify` skips it, and a clone that did not run the `git config` command
has no hooks at all.

## Code quality

The `pre-push` hook runs [Qlty](https://qlty.sh) over the files in the commits
being pushed. It compares them with the upstream branch, so existing issues
never block a push. Only new issues in changed files do. The check is free,
runs locally, and needs no account.

```bash
curl https://qlty.sh | sh
git config core.hooksPath .githooks
```

`.qlty/qlty.toml` holds the configuration. It enables `biome` for TypeScript,
JavaScript, JSON, and CSS, `markdownlint` for Markdown, and `trufflehog` for
secrets. Add a linter with `qlty plugins enable <name>` and commit the change.
`qlty check --all` runs the same checks over the whole repository.

Qlty Cloud offers a score-based block and works without pull requests:
`qlty slop-one` fails a push that lowers the score of the changed files. It
needs a `TYPESAFE_API_KEY` and spends API credit per run, so it is not in the
hook.

## Deployment checklist (required)

1. **Zen**: create a dedicated API key for Quiosco; set a workspace monthly
   usage limit; disable auto-reload. Quiosco also enforces a server-side model
   allowlist and a daily translate budget as containment layers.
2. **KV**: `pnpm exec wrangler kv namespace create BUDGET` — paste the id into
   gitignored `wrangler.local.toml` (and into the `QUIOSCO_KV_NAMESPACE_ID`
   GitHub secret if you use CI deploy).
3. **D1**: `pnpm exec wrangler d1 create quiosco` — paste `database_id` into
   `wrangler.local.toml` and the `QUIOSCO_D1_DATABASE_ID` GitHub secret. Apply
   the schema:
   `pnpm exec wrangler d1 execute quiosco --remote --file worker/migrations/0001_sync.sql`.
4. **Secrets**:
   `pnpm exec wrangler secret put OPENCODE_API_KEY` and
   `pnpm exec wrangler secret put APP_TOKEN` (generate: `openssl rand -hex 32`).
   Recommended: `pnpm exec wrangler secret put JINA_API_KEY` (free key from
   jina.ai) — Cloudflare's shared egress IPs are rate-limited on the reader's
   anonymous tier, so the `jina` fallback rung returns 429 without it.
5. **Deploy**: `pnpm deploy` (or push to `main` — CI deploys after checks pass).
6. **Verify**: `GET /` returns the CSP header; `GET /api/health` returns 401
   without the token.
7. **Rate limit**: add a Cloudflare rate-limiting rule on `/api/*`. One shared
   `APP_TOKEN` gates the fetch proxy, Zen spend, and sync — treat it as the
   crown jewel.

### CI deploy (GitHub Actions)

Every push to `main` runs the check job, then injects resource ids into
`wrangler.toml` and runs `pnpm deploy`. Required repository secrets:

1. `CLOUDFLARE_ACCOUNT_ID` — from `pnpm exec wrangler whoami`.
2. `CLOUDFLARE_API_TOKEN` — create at
   [API Tokens](https://dash.cloudflare.com/profile/api-tokens) with the
   **Edit Cloudflare Workers** template, scoped to this account.
3. `QUIOSCO_KV_NAMESPACE_ID` — KV namespace id for `BUDGET`.
4. `QUIOSCO_D1_DATABASE_ID` — D1 `database_id` for `quiosco`.

```bash
gh secret set CLOUDFLARE_ACCOUNT_ID
gh secret set CLOUDFLARE_API_TOKEN
gh secret set QUIOSCO_KV_NAMESPACE_ID
gh secret set QUIOSCO_D1_DATABASE_ID
```

Also enable 2FA on the Cloudflare and OpenCode accounts.

### Sync (D1)

After D1 is created and the schema is applied (see checklist above):

1. Deploy as usual (`pnpm deploy`).
2. On each device: Settings → App token → Save → "Sync now".
   The app also syncs on open, after local changes, and when the network returns.

## Install on Android

1. Open the deployed URL in **Chrome for Android** → menu → **Install app**.
2. **Open the app once** so the service worker is active; sharing before that
   lands on a "Nothing received" screen.
3. Share an article from Chrome → pick Quiosco. Share selected text the same
   way (it becomes the article text, with the URL kept as the source link when
   provided).
4. Share an `.epub` file from any app (Files, Downloads) → pick Quiosco; the
   Add page opens in Book mode with the book ready to save. The share sheet
   entry comes from the manifest's `share_target` files entry, so the app must
   be reinstalled/updated after that entry changes. If a shared file arrives
   empty (a Chrome 153 bug), use Add → Book → pick the file instead.
5. After a manifest change, reinstall from Chrome (WebAPK update lag).

## Smoke test

```bash
QUIOSCO_URL=https://quiosco.<account>.workers.dev QUIOSCO_APP_TOKEN=<token> pnpm smoke
```

Runs the frozen list in `scripts/smoke-urls.json` through the real ladder and
prints per-URL results; fails below a 90% pass rate. The token is never
printed.

## Security notes

- The Zen key never reaches the client; only the Worker holds it, and upstream
  error bodies are never echoed.
- The app token lives in device localStorage and is sent only as a bearer
  header to your Worker. Rotate it by re-running `wrangler secret put APP_TOKEN`
  and updating Settings — the old token dies immediately.
- No CORS headers are ever emitted; `/api/*` rejects foreign `Origin` headers;
  the fetch proxy rejects non-http(s), credentials, non-standard ports, and all
  IP-literal hosts, and validates every redirect hop.
- Privacy: article text is sent to Zen for translation. Only the article URL is
  sent to jina.ai / web.archive.org / archive.ph, and only when earlier rungs
  fail. The Googlebot rung uses user-agent spoofing, kept for personal reading
  only.
- Personal use: read privately, never redistribute. Hard paywalls are not
  defeated; the manual text path is for content you already have access to.

## Acceptance (manual, Android)

Share a URL from Chrome → article extracts and (with translation enabled)
translates; share highlighted text → review screen prefills; mark read/unread,
archive, delete; copy translation; offline → clear error and retry; first-run
share before the SW is active shows "Nothing received".
