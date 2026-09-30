# Quiosco — Design

Date: 2026-09-30
Status: draft for review

## 1. Summary

Quiosco is a personal, single-user, Android-first PWA that turns shared reading into
translated reading. From the Android share sheet the user shares either:

- an **article URL** — Quiosco fetches the page, removes soft paywalls with a
  fallback ladder, and extracts the article text; or
- **full article text** — manually extracted by the user for hard/difficult
  paywalls; Quiosco skips fetching and uses the text as-is.

Quiosco then translates the text with the OpenCode Zen API using a custom prompt
(target language + user-defined rules) and keeps everything in a local
read/unread/archived list with copy-to-clipboard for the translation and the
original.

## 2. Goals / Non-goals

Goals:

- G1 Reliable for the top Spanish (Spain) newspaper websites (see §3).
- G2 Share by URL **and** by full text.
- G3 Translation via OpenCode Zen chat completions; configurable target language
  and rules; chunked for long articles; copyable results.
- G4 Local list with read / unread / archived states.
- G5 Zero infra cost: Cloudflare Workers free tier, on-device storage, free
  third-party fallbacks.
- G6 Small, idiomatic, tested TypeScript codebase.
- G7 No secret exposure: the Zen key stays server-side; the public endpoint
  cannot be used by anyone without the app token; abuse is bounded if the app
  token ever leaks.

Non-goals:

- No accounts, sync, or multi-user support.
- No iOS (Chrome Android is required for the share target).
- No guaranteed bypass of hard paywalls (NYT/WSJ etc.) — the manual text path
  covers those.
- No server-side article storage.
- No native app.

## 3. Empirical basis (verified live, 2026-09-30)

Plain HTTP fetch, no JavaScript execution:

| Paper | Direct fetch | Notes |
|---|---|---|
| El País | full text | soft paywall |
| El Mundo | full text | ISO-8859-15 charset |
| ABC | full text | Vocento; `_amp` variant exists |
| La Vanguardia | full text | soft paywall |
| El Confidencial | full text | soft paywall |
| Expansión | full text | ISO-8859-15 |
| El Periódico | full text | needs a real browser User-Agent |
| La Voz de Galicia | full text | metered |
| El Español | full text | soft paywall |
| Cinco Días | 403 direct | full text via Jina Reader fallback |

Conclusion: the top Spanish press is uniformly soft-paywalled and can be served
by a short fetch ladder. Hard-paywall titles are not reliably accessible to any
free method; for those, the supported path is sharing manually extracted text.

## 4. Architecture

Three pieces, one repo, one deployable:

- **PWA (client)** — React + TypeScript + Vite, installed via Chrome for Android.
  Owns extraction, storage, UI, and ladder orchestration.
- **Worker (server)** — Cloudflare Worker on the same origin. Serves the built
  PWA as static assets and exposes `/api/*`. Stateless; holds secrets only;
  applies security headers and never emits CORS headers (§11).
- **Storage (device)** — articles in IndexedDB; settings in localStorage.
  Nothing about the user's reading is stored server-side.

Flow for a URL share:

```
Android share sheet
  -> WebAPK POST /share           (manifest share_target, method POST)
  -> Service worker stores payload in Cache API, responds 303 -> /share
  -> /share route reads payload, classifies (URL vs text)
  -> extraction ladder via worker /api/fetch (client-side orchestration)
  -> DOMParser + Mozilla Readability extraction (client)
  -> article saved (unread) -> translation: worker /api/translate -> Zen
  -> article view
```

Why extraction is client-side: native charset support (`TextDecoder` handles
ISO-8859-15), real `DOMParser`, and it keeps the Worker well inside the free
tier's 10 ms CPU budget (the Worker never parses HTML).

Why the share target is POST: full article text can be tens of KB; GET query
strings cannot carry that. POST bodies have no practical limit here. The service
worker intercepts the POST, stores `{title, text, url}` in the Cache API under a
well-known key, and redirects to `/share` (GET) where the app picks it up.

## 5. Share handling

Manifest entry:

```json
"share_target": {
  "action": "/share",
  "method": "POST",
  "enctype": "multipart/form-data",
  "params": { "title": "title", "text": "text", "url": "url" }
}
```

Service worker: on `POST /share` -> `request.formData()` -> store payload ->
`Response.redirect("/share", 303)`. The app shell is precached, so this works
offline too (payload stored, fetching deferred).

Classification (pure function, unit-tested):

- `url` = the `url` param, else the first http(s) URL found in `text`.
- URL mode when a URL exists and the accompanying text is empty or is just the
  URL/title.
- TEXT mode when `text` is >= 400 characters and is not just a URL. If a URL is
  also present, it is kept as the source link.
- Both URL and long text -> TEXT mode (user extracted text deliberately).
- Anything else -> manual entry screen, prefilled with whatever was shared.

TEXT mode shows a short review screen: editable text, title (defaults to the
shared title or the first line), optional source URL -> "Save & translate".
No review screen for the common URL share; it goes straight to progress.

URL mode on extraction failure shows: Retry / Paste or edit text / Open
original. The paste path pre-fills with any partial text recovered.

## 6. Extraction ladder

The client orchestrates rungs; each rung is one worker call
(`GET /api/fetch?mode=...&url=...`). The worker returns raw bytes plus metadata
headers (`x-quiosco-via`, `x-quiosco-final-url`, `x-quiosco-status`).

| # | Rung | What it does |
|---|------|--------------|
| 1 | `direct` | fetch with a Chrome UA and `Accept-Language: es-ES,es` |
| 2 | `googlebot` | same URL with the Googlebot UA (13ft technique) |
| 3 | `jina` | `https://r.jina.ai/` + the absolute article URL (construction spelled out and tested with query strings and fragments) — returns markdown, no Readability needed; keyless at 20 RPM, optional free key |
| 4 | `wayback` | archive.org availability API, then the raw `id_` snapshot |
| 5 | `archive_ph` | `archive.ph/newest/<url>` lookup, best-effort |

After rungs 1, 2, 4, 5 the client decodes (charset from `content-type` header or
`<meta charset>`, then `TextDecoder`), parses with `DOMParser`, and extracts with
`@mozilla/readability`, falling back to body text when Readability returns null.
Rung 3 is already extracted markdown.

Quality gate after every rung — text passes when it has >= 600 characters,
>= 3 paragraphs, and no paywall/anti-bot markers (multi-language phrase list,
e.g. "suscríbete para seguir leyendo", "subscribe to continue",
"checking your browser"). First passing rung wins; `via` is recorded.

Worker-side guards are specified in §11.6: http(s) only, port and credential
restrictions, per-redirect-hop validation, host denylist, 8 MB response cap,
20 s timeout per rung; cookies are never forwarded (which also defeats metered
counters).

Worker response hygiene: upstream hop-by-hop headers, `Set-Cookie`, and
`Content-Length`/`Content-Encoding` are stripped (Workers auto-decompresses
upstream gzip/br, so forwarding them blindly would corrupt bodies); the
response carries an inert content type with the sanitized charset forwarded,
so the client's decode step above has what it needs.

## 7. Translation

Worker `POST /api/translate` with `{model, system, text}` forwards to
`https://opencode.ai/zen/v1/chat/completions` with `Authorization: Bearer` from
the Worker secret `OPENCODE_API_KEY`. Non-streamed, 120 s timeout, 2 MB request
body cap, returns `{text, usage}`. Upstream errors are mapped to short generic
messages; upstream response bodies are never echoed to the client or logged
(§11.2).

Client side:

- Prompt built from settings: fixed instructions ("Translate to {language}.
  Rules: {rules}. Preserve paragraph structure and quotes. Output only the
  translation, no commentary.") + the chunk as user message.
- Paragraph-aware chunker, <= 12,000 chars per chunk; chunks translate
  sequentially with `k/n` progress; per-chunk retry; partial results persist.
- `translationStatus`: `pending | running | done | error`, with resume from the
  failed chunk.

Settings (localStorage): `targetLanguage`, `rules`, `model`, `appToken`,
`autoTranslate` (default on). The model field is a free-text input with a
curated suggestion list; default `deepseek-v4.1-flash`, with the Zen free models
(`big-pickle`, `space-bunny-free`, `longcat-2.5-preview-free`, ...) offered.
The Worker enforces an allowlist (`ALLOWED_MODELS`) and rejects any other id
with 400, so a leaked app token cannot select expensive models (§11.4).

Guard: article text capped at 150,000 characters.

## 8. Data model

```ts
type ArticleStatus = "unread" | "read" | "archived";
type TranslationStatus = "pending" | "running" | "done" | "error";
type Via = "direct" | "googlebot" | "jina" | "wayback" | "archive_ph" | "manual";

interface Article {
  id: string;                 // crypto.randomUUID()
  url: string | null;         // source URL when known
  title: string;
  site: string | null;        // hostname
  text: string;               // extracted original
  via: Via;
  translation: string | null;
  translationStatus: TranslationStatus;
  translatedChunks: number;
  totalChunks: number;
  status: ArticleStatus;
  error: string | null;
  createdAt: number;
  updatedAt: number;
}
```

IndexedDB database `quiosco` (via `idb`), single `articles` store keyed by `id`,
with a `createdAt` index. The pending share handoff uses Cache Storage
(`quiosco-share` cache), not the database, to keep the service worker
dependency-free.

Duplicate URL detection normalizes before comparing (strip fragment and
tracking params; treat `_amp`/`?amp` variants as the same article); if already
stored, open the existing article and offer re-translation instead of creating
a second entry.

The app calls `navigator.storage.persist()` so the browser is less likely to
evict stored articles. Export/import is noted future work, not v1.

## 9. UI

Four routes:

- `/` — List. Tabs: Unread / Read / Archived (with counts), sorted by
  `createdAt` desc. Row: title, site, date, status chip, translation chip.
  A small "Add by URL or text" affordance (manual text entry, useful on
  desktop and as a fallback).
- `/share` — Share processing. Shows fetch rung and translation progress;
  navigates to the article on success; error card with Retry / Paste text /
  Open original on failure.
- `/article/:id` — Detail. Title, source link, Original | Translation toggle,
  copy translation, copy original, mark read/unread, archive, delete,
  re-translate, edit text. Opening auto-marks read.
- `/settings` — target language, rules, model, app token, auto-translate,
  and a "Check connection" button (worker `/api/health`).

Mobile-first, dark-mode aware, hand-written CSS (no UI framework). Install
affordance documented in README (Chrome -> Install app).

## 10. Error handling

- Extraction failure -> error card; manual text path always available.
- Translation failure -> article saved with `error`, chip in list, resume from
  failed chunk.
- Offline -> clear message + Retry; stored articles remain readable.
- 401 from worker -> prompt to check the app token in Settings.
- Worker unreachable -> Retry; nothing lost (pending share persists in Cache).

## 11. Security

### 11.1 Threat model

- The deployed URL is public; assume a stranger knows it.
- Secret #1: the OpenCode Zen key (money). It must never leave the Worker.
- Secret #2: the app token (device-side). It is the only key that gates the
  Worker; if it leaks, an attacker could spend Zen credits — so it is
  high-entropy, rotatable, and spend is capped (§11.4).
- Hostile input: fetched pages and shared text are untrusted and must never
  execute code or exfiltrate the app token.
- Out of scope: a compromised phone, a compromised Cloudflare/OpenCode account,
  traffic analysis.

### 11.2 Zen key handling (never exposed)

- `OPENCODE_API_KEY` exists only as a Worker secret. Never in the repo, never
  in the client bundle, never in any response.
- The client never sends, stores, or sees the Zen key. It calls
  `/api/translate`; the Worker attaches the key upstream.
- The Worker logs no tokens and no request bodies; upstream error bodies are
  never echoed or logged.
- Required deployment step (README checklist): a dedicated Zen key for
  Quiosco, a workspace monthly usage limit, and auto-reload disabled — the
  hard cap on blast radius. The Settings screen links to this checklist.

### 11.3 Access control (the endpoint cannot be used by others)

- Every `/api/*` route requires `Authorization: Bearer <APP_TOKEN>`.
  `APP_TOKEN` is a separate secret: 32 random bytes (`openssl rand -hex 32`),
  stored as a Worker secret and entered once in app Settings (device only).
- Comparison uses the platform timing-safe primitive
  (`crypto.subtle.timingSafeEqual` on Workers; SHA-256 digest comparison as
  fallback).
- No CORS headers are ever emitted. The app is same-origin; cross-site browser
  requests cannot attach the bearer header without an approved preflight.
  Defense-in-depth: a request carrying an `Origin` header that differs from
  the app origin is rejected (the CLI smoke script sends no Origin). The
  check applies to `/api/*` only, never to `/share`.
- Missing, wrong, or malformed credentials get a uniform 401/400 with no
  details.
- Kill switch: rotating `APP_TOKEN` (re-run `wrangler secret put` + update
  Settings on the phone) instantly invalidates every other holder.

### 11.4 Abuse containment (rotation safety net)

- Zen workspace monthly limit + auto-reload disabled caps worst-case spend
  (required, §11.2).
- Server-side model allowlist: the Worker only forwards model ids on an
  allowlist (`ALLOWED_MODELS`); anything else is rejected with 400. A leaked
  token cannot select expensive models. The default allowlist matches the
  curated Settings list.
- KV-backed daily budget: the Worker counts translate chunks per day (default
  200, configurable) in Workers KV and returns 429 beyond the cap — a second
  containment layer independent of Zen account settings.
- Translate body capped at 2 MB; fetch responses capped at 8 MB (§6).
- Optional ops step (documented, not required): a Cloudflare rate-limiting
  rule on `/api/*`.
- Account hygiene (README): 2FA on the Cloudflare and OpenCode accounts.

### 11.5 Client hardening (protects the token and user data on-device)

- Security headers on every response, including the HTML document:
  `Content-Security-Policy` (below), `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`,
  `Strict-Transport-Security`, `Permissions-Policy: camera=(),
  microphone=(), geolocation=()`; `/api/*` responses also
  `Cache-Control: no-store`. Delivery is guaranteed by configuring
  `assets.run_worker_first` (every response passes through the Worker; a
  `_headers` file is the fallback), and a test asserts `GET /` ships the CSP.
- CSP: `default-src 'self'; script-src 'self'; style-src 'self'
  'unsafe-inline'; img-src 'self' data:; connect-src 'self'; worker-src
  'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none';
  form-action 'none'`. Strict scripts; inline styles only because React style
  attributes need them; no third-party origins anywhere.
- Article titles, text, and translations render as text nodes only (React
  escaping); `dangerouslySetInnerHTML` is banned. Fetched HTML is parsed with
  `DOMParser` into an inert document, never attached to the live DOM.
- Shared text stays on the device: the service worker consumes the POST
  payload locally and stores it in Cache Storage under a well-known key
  (last share wins). The payload is deleted once the article is saved, or on
  explicit discard — it intentionally survives extraction/translation
  failures so Retry does not require re-sharing. If a share POST arrives
  before the service worker is active (first run), the Worker redirects
  without reading the body and `/share` shows "nothing received — share
  again or paste text" (README tells the user to open the app once after
  install).
- localStorage holds settings only (including APP_TOKEN); never the Zen key.
- The service worker precaches the app shell and stores the pending share;
  `/api/*` responses are never cached.

### 11.6 Fetch proxy safety (SSRF and abuse)

- http(s) only; URLs with embedded credentials rejected; ports restricted to
  80/443. URLs are canonicalized with `new URL()` before any check.
- IP-literal hosts are rejected outright. Canonicalization first makes this
  cover hex/decimal/octal IPv4 spellings and IPv4-mapped IPv6
  (`[::ffff:169.254.169.254]`).
- Host denylist (defense-in-depth): localhost, `*.local`, loopback/private/
  link-local ranges (v4 and v6), and known metadata endpoints —
  `169.254.169.254`, `169.254.170.2`, `100.100.100.200`,
  `metadata.google.internal`.
- Redirects followed manually (max 5), each hop re-validated with the same
  rules; the final URL is reported back.
- Network-layer backstop: `global_fetch_strictly_public` is explicitly
  enabled in the wrangler config, so Cloudflare blocks fetches to private
  addresses even under DNS rebinding; the denylist above is
  defense-in-depth.
- 20 s timeout per rung; 8 MB cap; cookies never forwarded.

### 11.7 Privacy

- Article text is sent to Zen for translation (that is the feature); URLs are
  sent to ladder third parties (jina / wayback / archive.ph) only on
  escalation — documented in README and Settings.
- No server-side storage of articles, reading history, or URLs; no analytics.
- README notes the Googlebot-UA rung is user-agent spoofing, kept for personal
  reading only.
- README disclaimer: personal reading only, never redistribute; hard paywalls
  are not defeated — the manual text path is for content the user already has
  access to.

## 12. Testing & acceptance

- Unit tests (Vitest + jsdom):
  - share classification (URL in `text`, both fields, short text, empty),
  - chunker boundaries and merge,
  - prompt builder,
  - quality gate against dated fixtures captured from real pages of the §3
    list, plus synthetic per-site patterns (CSS overlay paywall, ISO-8859-15
    page, challenge page),
  - SSRF validator: canonicalization, hex/decimal/octal IPv4 and IPv4-mapped
    IPv6 rejection, credential/port rejection, redirect-hop validation,
  - store CRUD, settings, duplicate-URL normalization.
- Worker tests:
  - auth middleware on every route including `/api/health`: 401 for missing,
    wrong, and malformed tokens; 200 with the correct token,
  - cross-origin `Origin` rejected on `/api/*`; no CORS headers,
  - security headers asserted on `GET /` (CSP, nosniff) and `/api/*`
    (no-store),
  - upstream-error redaction: `/api/translate` errors never echo upstream
    bodies,
  - model allowlist enforcement and daily budget (429 beyond the cap).
- E2E (Playwright): POST -> service worker -> Cache -> `/share` handoff, run
  against a production build so headers and CSP are applied.
- Smoke: `scripts/smoke.mjs` runs against the deployed worker over the frozen
  URL list (Appendix A) and prints a per-URL table (rung used, characters,
  pass/fail). A URL passes only when the quality gate passes with >= 600
  characters. The script takes the token from `QUIOSCO_APP_TOKEN` and never
  prints it.
- Acceptance: >= 90% of the smoke list extracts without manual text; 100%
  reachable end-to-end via manual text path; the Android share QA checklist
  (URL share, highlighted-text share, first-run no-SW behavior,
  install/update caveat — run against a production-CSP build) passes.
- CI (GitHub Actions): typecheck, lint/format (Biome), tests, build, bundle
  scan (no key material in the built client). The smoke list runs weekly on a
  schedule (repo secrets) and on release.

## 13. Deployment & operations

- Toolchain: Node 22+, pnpm, wrangler. `pnpm dev` runs Vite + `wrangler dev`
  with a Vite proxy for `/api`, keeping the dev loop same-origin (no CORS
  anywhere); `pnpm deploy` builds and deploys.
- `wrangler.toml` pins `compatibility_date`, enables
  `global_fetch_strictly_public`, sets `assets.run_worker_first`, and binds
  the KV namespace used for the daily translate budget.
- Secrets: `wrangler secret put OPENCODE_API_KEY` (dedicated key), `APP_TOKEN`
  (generate with `openssl rand -hex 32`), optional `JINA_API_KEY`. Local dev
  uses `.dev.vars`, which is gitignored.
- Required Zen setup (README checklist): workspace monthly limit, auto-reload
  off.
- Optional hardening (README): Cloudflare rate-limiting rule on `/api/*`, 2FA
  on Cloudflare and OpenCode accounts.
- Rotation documented: `wrangler secret put APP_TOKEN` again + update the token
  in the app's Settings; the old token is dead immediately.
- Hosting: `https://quiosco.<account>.workers.dev` (HTTPS, required for PWA
  install and clipboard API). Custom domain is out of scope.
- README covers: secrets, the deploy checklist (Appendix B), install on
  Android, "open the app once after install so the service worker is active",
  reinstall note when the manifest changes (WebAPK update lag).
- Cost: $0 infra; only Zen usage (fractions of a cent per article with cheap
  models; free models available).

## 14. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Worker egress IP blocked by a publisher | ladder escalates to jina/googlebot; weekly smoke run detects |
| Publisher markup changes | quality gate + manual text path; fixtures updated |
| Free Zen models churn | model is a setting; server allowlist updatable via config |
| archive.ph / jina availability | manual text path; rung order minimizes dependency |
| WebAPK share target needs reinstall after manifest change | README note |
| Article too long for one request | chunker + 150k char cap |
| Browser eviction / cleared storage loses local articles | `navigator.storage.persist()`; export/import future work |

## 15. Decisions resolved

- Share target: POST + service-worker handoff (long text support).
- Extraction: client-side (charset, DOM quality, Worker CPU budget).
- Worker: thin authenticated proxy; no state, no parsing.
- Storage: IndexedDB on device; no server persistence.
- Ladder order: direct -> googlebot -> jina -> wayback -> archive.ph.
- Translation: non-streamed, sequential chunks, resumable.
- Default model: `deepseek-v4.1-flash` (configurable; free models surfaced).
- Security: Zen key is a Worker-only secret; all `/api/*` gated by a separate
  high-entropy `APP_TOKEN` (timing-safe compare, no CORS, strict CSP delivered
  via `run_worker_first`); leak containment via required Zen monthly limit +
  KV daily budget + model allowlist + rotation; fetch proxy hardened against
  SSRF with `global_fetch_strictly_public`.

## Appendix A — Smoke URL list

`scripts/smoke-urls.json` in the repo freezes the exact URL list used by the
acceptance run: ~18 URLs covering the top Spanish papers by public ranking
(OJD/Comscore), including sports and at least two regional titles. Each entry:
`{ url, site, expected: "any" }`. The list is versioned so the criterion in
§12 is reproducible and auditable; changes to it are code review items.

## Appendix B — Deployment checklist

1. Zen: create a dedicated API key for Quiosco; set a workspace monthly usage
   limit; disable auto-reload.
2. Cloudflare: `wrangler secret put OPENCODE_API_KEY`; generate and set
   `APP_TOKEN` (`openssl rand -hex 32`); optional `JINA_API_KEY`.
3. Config: pin `compatibility_date`; enable `global_fetch_strictly_public`;
   set `assets.run_worker_first`; bind the budget KV namespace.
4. Deploy: `pnpm deploy`; verify `GET /` returns the CSP header and
   `/api/health` returns 401 without the token.
5. Android: install from Chrome, open once (service worker active), then run
   the share QA checklist.
6. Optional: Cloudflare rate-limiting rule on `/api/*`; 2FA on both accounts.
