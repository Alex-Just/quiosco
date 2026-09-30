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
  PWA as static assets and exposes `/api/*`. Stateless; holds secrets only.
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
| 3 | `jina` | `https://r.jina.ai/<url>` — returns markdown, no Readability needed; keyless at 20 RPM, optional free key |
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

Worker-side guards: http(s) only; SSRF denylist (localhost, private ranges,
link-local, `.local`); 8 MB response cap; 20 s timeout per rung; cookies never
forwarded (which also defeats metered counters).

## 7. Translation

Worker `POST /api/translate` with `{model, system, text}` forwards to
`https://opencode.ai/zen/v1/chat/completions` with `Authorization: Bearer` from
the Worker secret `OPENCODE_API_KEY`. Non-streamed, 120 s timeout, returns
`{text, usage}`.

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

Duplicate URL: if the URL is already stored, open the existing article and offer
re-translation instead of creating a second entry.

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

## 11. Security & privacy

- `/api/*` requires `Authorization: Bearer <APP_TOKEN>` (worker secret,
  constant-time comparison).
- The Zen key lives only in the Worker secret store; it never reaches the client.
- No article content or URLs are logged server-side.
- SSRF guard + size/time limits as in §6.
- Third-party rungs (jina, wayback, archive.ph) see the article URL only when the
  ladder escalates to them; this is documented in the README and visible in
  Settings.
- Personal-use disclaimer in README: content is read privately, never
  redistributed; hard paywalls are not defeated — the manual text path is for
  content the user already has access to.

## 12. Testing & acceptance

- Unit tests (Vitest + jsdom):
  - share classification (URL in `text`, both fields, short text, empty),
  - chunker boundaries and merge,
  - prompt builder,
  - quality gate (fixtures per site pattern: CSS overlay paywall, ISO-8859-15
    page, challenge page),
  - SSRF validator, store CRUD, settings.
- Worker: unit tests for pure helpers; `scripts/smoke.mjs` runs against the
  deployed worker over a curated list (~18 URLs covering the top Spanish
  papers) and prints a per-URL table (rung used, characters, pass/fail).
- Acceptance: >= 90% of the smoke list extracts without manual text; 100%
  reachable end-to-end via manual text path; Android share QA checklist (URL
  share, highlighted-text share, install/update caveat) passes.
- CI (GitHub Actions): typecheck, lint/format (Biome), tests, build.

## 13. Deployment & operations

- Toolchain: Node 22+, pnpm, wrangler. `pnpm dev` runs Vite + `wrangler dev`;
  `pnpm deploy` builds and deploys.
- Secrets: `wrangler secret put OPENCODE_API_KEY`, `APP_TOKEN` (optional
  `JINA_API_KEY`).
- Hosting: `https://quiosco.<account>.workers.dev` (HTTPS, required for PWA
  install and clipboard API). Custom domain is out of scope.
- README covers: secrets, deploy, install on Android, "open the app once after
  install so the service worker is active", reinstall note when the manifest
  changes (WebAPK update lag).
- Cost: $0 infra; only Zen usage (fractions of a cent per article with cheap
  models; free models available).

## 14. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Worker egress IP blocked by a publisher | ladder escalates to jina/googlebot; smoke test detects |
| Publisher markup changes | quality gate + manual text path; fixtures updated |
| Free Zen models churn | model is a setting with free-text id |
| archive.ph / jina availability | manual text path; rung order minimizes dependency |
| WebAPK share target needs reinstall after manifest change | README note |
| Article too long for one request | chunker + 150k char cap |

## 15. Decisions resolved

- Share target: POST + service-worker handoff (long text support).
- Extraction: client-side (charset, DOM quality, Worker CPU budget).
- Worker: thin authenticated proxy; no state, no parsing.
- Storage: IndexedDB on device; no server persistence.
- Ladder order: direct -> googlebot -> jina -> wayback -> archive.ph.
- Translation: non-streamed, sequential chunks, resumable.
- Default model: `deepseek-v4.1-flash` (configurable; free models surfaced).
