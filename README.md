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
  (multi-device sync), `/api/health`, plus the KOReader progress bridge
  (`/kosync` for the e-reader, `/api/kosync/*` for the app).
- **Storage** — IndexedDB on each device (offline-first), synced across your
  devices through Cloudflare D1 (`/api/sync`). See "Sync (D1)" below.

## Books

Import an `.epub` from the Add page (**Type: Book**). Quiosco parses it on the
device and keeps its chapters as text; the `.epub` file itself is not stored.
Parsed text is capped at 4M characters, enough for bilingual exports of large
novels.

Books share the library, actions, and read/unread/archived states with
articles, but they are **local-only**: they never enter `/api/sync`, and
reading position stays local, exactly as it does for articles. An optional
bridge exchanges positions with KOReader on a PocketBook or other e-reader,
and pushes the app's exact sentence back for quiosco's bilingual exports; see
"KOReader progress sync" below.

A book opens in Zen. Translation mode is a Zen-only toggle: a book with no
translations yet starts in the original text, and one that already has
translations saved reopens translated (with an app token configured). When
on, it translates the current sentence and the pages ahead in one request,
using the surrounding text as context, and spends from the same Zen daily
budget as articles. Each sentence follows your translation rules — with the
usual numbered table, the reader sees both languages with their language
flags on the same screen, as in articles.

Every translated sentence is cached permanently, keyed by content — the cache
is shared across books, so a sentence is never translated twice. The importer
adds a single runtime dependency: `fflate` (EPUB unzip).

### Narrated books (audiobook instead of TTS)

A book can play its recorded audiobook instead of synthesized speech: tap a
sentence and you hear the narrator read that exact sentence. The mapping is
computed once, offline.

```bash
pnpm audiobook --epub "book.epub" --audio ~/audiobook/4 --dry-run   # check the mapping
pnpm audiobook --epub "book.epub" --audio ~/audiobook/4 --skip 4    # build the pack
```

The tool parses the EPUB with the app's own importer and sentence splitter, so
unit indices match what the reader renders. It checks every audio file for
incomplete downloads, transcribes each track with mlx-whisper (cached per
chapter, so an interrupted run resumes), aligns the transcript to the book text,
and writes `<epub name>.narration.zip`.

`--skip N` says which parsed chapter track 1 narrates. Audiobooks skip the
cover, title page and section pages that the EPUB carries, so the counts
usually differ. Without `--skip` the tool prints the chapter table with a
suggested offset; `--dry-run` prints the full mapping first.

Audio is transcoded to mono Opus at 32 kbps by default, about 14 MB per hour.
`--copy` keeps the originals; `--bitrate` tunes the trade-off. Transcription
runs at roughly 8.5 times realtime on an M4, so a 30 hour book takes about 3.5
hours.

**Import.** In the book, **More**, **Add audiobook**, pick the `.zip`. The pack
is stored on the device (IndexedDB), never synced, and removed with the book.
From then on the Zen **Listen** control and a sentence's **Listen** action play
the recording. Chapters the audiobook does not cover keep using TTS.

Only the original text can be narrated: the recording does not contain the
translation, so translated screens still use TTS.

See [docs/audiobook-alignment.md](docs/audiobook-alignment.md) for the full
runbook, timing, and troubleshooting.

See [docs/audiobook-alignment.md](docs/audiobook-alignment.md) for the full
runbook, including `--dry-run` and audio-integrity checks.

## Diagnostics (local log + optional Sentry)

The app keeps a short on-device log (TTS picks, settings TTS changes, warnings).
Open **Settings → Diagnostics** to **Copy**, **Share**, or **Clear** it.

Optional client Sentry: create a free [Sentry](https://sentry.io) React
project, set `VITE_SENTRY_DSN` in the Vite env (for example `.env.local`).
For CI deploy to `main`, set the same value as a GitHub Actions repository
secret named `VITE_SENTRY_DSN` — the deploy job passes it into `pnpm build`.
With no DSN the app still runs; only the local log is used. Do not put this
client DSN in `wrangler secret` (it is a public browser value).

Optional Worker Sentry: create a separate Cloudflare Workers project in
Sentry, then set `SENTRY_DSN` via `pnpm exec wrangler secret put SENTRY_DSN`
(and optionally in `.dev.vars` for local). The Worker uses
`@sentry/cloudflare` and reports only when that secret is present.

## Local EPUB translation (OpenCode app)

`pnpm translate:epub <book.epub>` parses the EPUB on this machine and
translates it window by window through the OpenCode app's local service, using
its stored model credentials. It does not use the Worker, `OPENCODE_API_KEY` or
`APP_TOKEN`.

```bash
pnpm translate:epub /path/to/book.epub
pnpm translate:epub /path/to/book.epub --dry-run
pnpm translate:epub /path/to/book.epub --max-windows 2
```

The default model is `opencode/deepseek-v4.1-flash-free`; override it with
`--model <provider/model>`. Each accepted sentence is cached by content in
`~/.cache/quiosco/epub-translations.json` (override with `--cache`), so an
interrupted run resumes without paying for the same sentence twice. The output
is the same bilingual, text-only EPUB the reader exports, written next to the
input as `<title>-bilingual.epub` (override with `--output`).

The free model is cloud inference served by OpenCode, not an offline model. For
a fully offline pipeline, configure Ollama or LM Studio as an OpenCode provider
and pass its model with `--model`. For a multi-hour book, keep the Mac awake
with `caffeinate -i pnpm translate:epub ...`; an interrupted run resumes from
the cache.

The exported EPUB also carries `OEBPS/quiosco-bilingual.json`, a source /
translation sidecar. Importing it into Quiosco seeds the sentence cache and
opens the paired Zen view without retranslating; other EPUB readers ignore the
sidecar.

See [docs/local-epub-translation.md](docs/local-epub-translation.md) for model
access, long-running supervisor examples, options, output limitations and
troubleshooting.

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

`pre-push` runs `pnpm check` first (same steps as the CI `check` job:
typecheck, lint, test, build, scan), then the Qlty quality check. It blocks
the push when either step fails. It is a guardrail, not a guarantee:
`--no-verify` skips it, and a clone that did not run the `git config` command
has no hooks at all.

## Code quality

The `pre-push` hook runs `pnpm check`, then [Qlty](https://qlty.sh) over the
files in the commits being pushed. Qlty compares them with the upstream
branch, so existing issues never block a push. Only new issues in changed
files do. The check is free, runs locally, and needs no account.

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
   both schemas (the wrapper picks up `wrangler.local.toml`):
   `node scripts/wrangler-run.mjs d1 execute quiosco --remote --file worker/migrations/0001_sync.sql`
   and
   `node scripts/wrangler-run.mjs d1 execute quiosco --remote --file worker/migrations/0002_kosync.sql`.
4. **Secrets**:
   `pnpm exec wrangler secret put OPENCODE_API_KEY` and
   `pnpm exec wrangler secret put APP_TOKEN` (generate: `openssl rand -hex 32`).
   Optional for premium TTS: `pnpm exec wrangler secret put ELEVENLABS_API_KEY`
   (Settings → TTS provider → ElevenLabs; paste any Voice ID in the app).
   Recommended: `pnpm exec wrangler secret put JINA_API_KEY` (free key from
   jina.ai) — Cloudflare's shared egress IPs are rate-limited on the reader's
   anonymous tier, so the `jina` fallback rung returns 429 without it.
   Optional KOReader progress sync: `pnpm exec wrangler secret put KOSYNC_USER`
   and `pnpm exec wrangler secret put KOSYNC_KEY` (see below).
   Optional Worker Sentry: `pnpm exec wrangler secret put SENTRY_DSN` with the
   DSN from a dedicated Workers project (not the React `VITE_SENTRY_DSN`).
5. **Deploy**: `pnpm deploy` (or push to `main` — CI deploys after checks pass).
6. **Verify**: `GET /` returns the CSP header; `GET /api/health` returns 401
   without the token.
7. **Rate limit**: add Cloudflare rate-limiting rules on `/api/*` and
   `/kosync/*`. One shared `APP_TOKEN` gates the fetch proxy, Zen spend,
   sync, and the app-facing kosync routes — treat it as the crown jewel. The
   kosync route is public by protocol and authenticates with a single MD5 key.

### CI deploy (GitHub Actions)

Every push to `main` runs the check job, then injects resource ids into
`wrangler.toml` and runs `pnpm deploy`. Required repository secrets:

1. `CLOUDFLARE_ACCOUNT_ID` — from `pnpm exec wrangler whoami`.
2. `CLOUDFLARE_API_TOKEN` — create at
   [API Tokens](https://dash.cloudflare.com/profile/api-tokens) with the
   **Edit Cloudflare Workers** template, scoped to this account.
3. `QUIOSCO_KV_NAMESPACE_ID` — KV namespace id for `BUDGET`.
4. `QUIOSCO_D1_DATABASE_ID` — D1 `database_id` for `quiosco`.
5. `VITE_SENTRY_DSN` — optional; React client DSN so production builds send
   diagnostics to Sentry (omit to keep client logging local-only).

```bash
gh secret set CLOUDFLARE_ACCOUNT_ID
gh secret set CLOUDFLARE_API_TOKEN
gh secret set QUIOSCO_KV_NAMESPACE_ID
gh secret set QUIOSCO_D1_DATABASE_ID
gh secret set VITE_SENTRY_DSN   # optional
```

Also enable 2FA on the Cloudflare and OpenCode accounts.

### Sync (D1)

After D1 is created and the schema is applied (see checklist above):

1. Deploy as usual (`pnpm deploy`).
2. On each device: Settings → App token → Save → "Sync now".
   The app also syncs on open, after local changes, and when the network returns.

## KOReader progress sync

Quiosco can exchange reading positions with KOReader on a PocketBook (or any
KOReader). For a quiosco-generated `*-bilingual*.epub` the bridge is two-way:
KOReader pushes and the app offers to jump, and reading in the app pushes the
exact sentence back so KOReader resumes there. For any other EPUB it is
read-only: KOReader's position is a CRe XPointer quiosco cannot generate, so
the app only offers the approximate percentage. The bridge is off until both
`KOSYNC_USER` and `KOSYNC_KEY` are set.

How it works:

- The Worker exposes a kosync-compatible server at `/kosync`.
- The KOReader document matching method (Binary or Filename) does not affect
  the bridge: quiosco links by the metadata filename/title, not by the digest.
  Pick Filename if you also sync between KOReader devices.
- With **Send document metadata** enabled, KOReader includes the EPUB
  basename, title, and authors in each push. Quiosco stores them and matches a
  local book by its import filename, falling back to title/author.
- Opening a book asks `/api/kosync/progress`. A *-bilingual*.epub exported
  by quiosco carries an XPointer that resolves to the exact chapter and
  sentence; other EPUBs fall back to a percentage, so the prompt is offered
  but the landing point is approximate. The jump is always explicit.
- For a `*-bilingual*.epub`, the reader also pushes: 1.5 s after the sentence
  settles, and when the app is hidden, it writes the exact XPointer through
  `/api/kosync/push`. That route uses `APP_TOKEN`; the kosync MD5 key never
  reaches the client.
- A push never clobbers a newer e-reader position. The app sends the server
  timestamp it last read; if KOReader pushed after that, the row is left alone
  and the app stops pushing for the session. The app also never pushes while a
  jump banner is showing.
- The app can only push a book after KOReader has pushed it at least once:
  that first push supplies the document id the app writes to. A renamed local
  export still targets that document, so a `-v5` copy works.

Setup:

1. Choose a long random sync password and compute its MD5:
   `printf %s 'your-password' | md5sum` (Linux) or
   `printf %s 'your-password' | md5 -q` (macOS).
2. Set the secrets:
   `pnpm exec wrangler secret put KOSYNC_USER` (for example `quiosco`) and
   `pnpm exec wrangler secret put KOSYNC_KEY` (the MD5, never the plaintext).
3. Apply the kosync migration (see the checklist above) and deploy.
   Verify with `curl https://<quiosco-domain>/kosync/healthcheck`; it returns
   `{"state":"OK"}`.
4. On the PocketBook: **Progress sync → Custom sync server** →
   `https://<quiosco-domain>/kosync` (no trailing slash, no `/users/auth`).
   Use **Register / Login** with `KOSYNC_USER` and the **plaintext** password
   (KOReader hashes it before sending; `KOSYNC_KEY` is only the server-side
   hash), turn **Send document metadata** on, then **Push progress from this
   device now**.
5. Open the same EPUB in quiosco. Books imported before this feature have no
   original filename, so they fall back to title/author; re-import for exact
   matching. For two-way sync, open the book once in KOReader and push, then
   read in quiosco: each settled sentence is pushed back and KOReader resumes
   there on its next pull.

Caveats:

- EPUB only, and progress only: no highlights, notes, or bookmarks.
- A quiosco `*-bilingual*.epub` export maps exactly by XPointer, because its
  chapters and sentence paragraphs are generated deterministically. That is
  also the only file the app pushes; a version suffix such as
  `-bilingual-v5.epub` is fine. Other EPUBs use KOReader's page-based
  percentage for the read side (approximate, usually within a page or two)
  and stay read-only.
- The app pushes only while it is open, with a flush when it is hidden: a TWA
  has no background sync. A network failure is silent and retries on the next
  page turn.
- Different editions or modified files do not match. As in KOReader, a
  mismatch is silent: the lookup simply finds nothing.
- Percentage matches only offer forward jumps, matching KOReader's default
  `sync_backward = Disable`. An exact bilingual match may be behind the local
  position so a previous approximate jump can be corrected; it is still only
  an offer, never an automatic move. Dismissals are versioned, so a mapping
  fix can surface the corrected position once.
- The server stores `filename`, `title`, and `authors` when KOReader sends
  them. The official server discards this metadata; quiosco needs it to link
  the book, so with **Send document metadata** off the bridge cannot match new
  pushes (the app has no document digest).
- `/kosync/*` is public by protocol and authenticates with one MD5 key; the
  app-facing `/api/kosync/*` routes use `APP_TOKEN` instead. Use a strong
  password and a rate-limiting rule.

Local development: apply both schemas to the local D1 once, then run
`pnpm dev`:

```bash
node scripts/wrangler-run.mjs d1 execute quiosco --local --file worker/migrations/0001_sync.sql
node scripts/wrangler-run.mjs d1 execute quiosco --local --file worker/migrations/0002_kosync.sql
```

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
6. To open an `.epub` straight from Telegram, Files, or Downloads (Android's
   *Open with* chooser) install the thin trusted-web-activity wrapper. Download
   [`quiosco.apk`](https://github.com/Alex-Just/quiosco/releases/latest/download/quiosco.apk)
   from the latest release, or build it from [`android/`](android/README.md).
   The PWA cannot register for `ACTION_VIEW`; the wrapper hands the file to the
   same Book importer and shares Chrome's storage with the installed app.

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
  fail; for X/Twitter post links, the post id is sent to api.fxtwitter.com
  (and, if that fails, cdn.syndication.twimg.com). The Googlebot rung uses
  user-agent spoofing, kept for personal reading only.
- The optional KOReader bridge stores only the reading position plus the
  filename/title/authors KOReader sends when **Send document metadata** is on.
  Reading a bilingual export in quiosco updates that stored position; the
  bridge never stores book content. Its key is an MD5 hash and `/kosync/*` is
  public by protocol: use a strong password and a rate-limiting rule.
- Personal use: read privately, never redistribute. Hard paywalls are not
  defeated; the manual text path is for content you already have access to.

## Acceptance (manual, Android)

Share a URL from Chrome → article extracts and (with translation enabled)
translates; share highlighted text → review screen prefills; mark read/unread,
archive, delete; copy translation; offline → clear error and retry; first-run
share before the SW is active shows "Nothing received".
