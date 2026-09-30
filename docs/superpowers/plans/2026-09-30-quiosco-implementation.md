# Quiosco Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Quiosco: an Android-first PWA that accepts shared article URLs or shared article text, extracts soft-paywalled Spanish press articles, translates them via OpenCode Zen, and keeps a local read/unread/archived list with copy-to-clipboard.

**Architecture:** One repo, one deployable. A Cloudflare Worker serves the Vite-built React PWA as static assets and exposes `/api/*` (authenticated thin proxy: fetch rung passthrough + Zen translation). All extraction (DOMParser + Mozilla Readability), ladder orchestration, storage (IndexedDB), and UI are client-side. The share target is `POST` + service-worker handoff via Cache Storage.

**Tech Stack:** TypeScript (strict), React 19, Vite, vite-plugin-pwa (injectManifest + Workbox), react-router-dom, `idb`, `@mozilla/readability`, Vitest (+ jsdom, fake-indexeddb), Playwright, Biome, wrangler, Cloudflare Workers (static assets + KV).

**Spec:** `docs/superpowers/specs/2026-09-30-quiosco-design.md` — read it alongside this plan; every task argues from it.

## Global Constraints

Copied verbatim from the spec; every task's requirements implicitly include these.

- Toolchain: Node >= 22, pnpm, wrangler. Working dir is the repo root (`~/dev/quiosco`).
- TypeScript `strict: true`; Biome for lint+format; no `any` in new code (use `unknown`).
- All article titles, text, and translations render as text nodes only; `dangerouslySetInnerHTML` is banned anywhere.
- No CORS headers are ever emitted. Security headers on **every** response, including the HTML document. CSP string (verbatim): `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`.
- `/api/*` requires `Authorization: Bearer <APP_TOKEN>`; timing-safe compare (`crypto.subtle.timingSafeEqual` on Workers, SHA-256 digest compare fallback); `Origin` check applies to `/api/*` only; missing/wrong creds get uniform 401; upstream error bodies never echoed or logged; Zen key is a Worker-only secret.
- Worker free-tier discipline: no HTML parsing in the Worker; <= 50 subrequests/request; no CORS; `assets.run_worker_first` + `global_fetch_strictly_public` enabled.
- Constants (exact values used across tasks): text-share threshold **400** chars; quality gate **>= 600** chars and **>= 3** paragraphs; chunk size **12,000** chars; article text cap **150,000** chars; fetch rung timeout **20 s**; translate timeout **120 s**; max redirects **5**; fetch response cap **8 MB**; translate request cap **2 MB**; daily chunk budget default **200**; `APP_TOKEN` is 32 random bytes hex (`openssl rand -hex 32`).
- Model allowlist default (verbatim): `deepseek-v4.1-flash,big-pickle,space-bunny-free,longcat-2.5-preview-free,mimo-v2.6-flash-free,nemotron-3.5-lightning-free,gemini-3.5-flash-lite`.
- Secrets never in the repo; `.dev.vars` is gitignored; the smoke script never prints the token.
- Ladder order everywhere: `direct -> googlebot -> jina -> wayback -> archive_ph`.
- Commit after every task; conventional commit messages.

## Task Index

1. Scaffold & tooling
2. Share classification, URL normalization, title derivation
3. Fixtures capture + quality gate
4. Extraction (charset decode + Readability)
5. Chunking + prompt builder
6. Settings + IndexedDB store
7. API client
8. Ladder + translation runner
9. Share payload, PWA manifest, service worker, icons
10. Worker foundation: env, security headers, auth
11. Worker: SSRF validator + `direct`/`googlebot` rungs
12. Worker: `jina`, `wayback`, `archive_ph` rungs
13. Worker: translate proxy + KV budget
14. Worker router: routing, health, `/share` redirect, asset passthrough
15. Smoke script + frozen URL list
16. UI: shell, list, add/review, settings, share flow, article page
17. Playwright E2E + bundle scan
18. README, CI workflow, acceptance prep

Before executing, optionally create an isolated worktree (superpowers:using-git-worktrees).

---

### Task 1: Scaffold & tooling

**Files:**
- Create: `package.json`, `tsconfig.json`, `biome.json`, `vite.config.ts`, `index.html`, `.gitignore`
- Create: `src/main.tsx`, `src/App.tsx`, `src/styles.css`
- Create: `worker/index.ts` (placeholder handler, replaced in Task 10)
- Create: `wrangler.toml`

**Interfaces:**
- Consumes: nothing.
- Produces: working commands `pnpm dev`, `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm typecheck`; `worker/index.ts` default-exports `{ fetch }`.

- [ ] **Step 1: Init package and install deps**

```bash
cd ~/dev/quiosco
pnpm init
pnpm add react react-dom react-router-dom idb @mozilla/readability
pnpm add -D typescript vite @vitejs/plugin-react vite-plugin-pwa vitest jsdom fake-indexeddb \
  workbox-core workbox-precaching workbox-routing workbox-strategies \
  @types/react @types/react-dom @types/node wrangler @biomejs/biome vite-node @playwright/test concurrently
```

- [ ] **Step 2: Write `package.json` scripts**

```json
{
  "name": "quiosco",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "concurrently -n api,web -c blue,green \"wrangler dev\" \"vite\"",
    "dev:api": "wrangler dev",
    "dev:web": "vite",
    "build": "vite build",
    "preview:api": "wrangler dev",
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "lint": "biome check .",
    "format": "biome format --write .",
    "icons": "node scripts/make-icons.mjs",
    "smoke": "vite-node scripts/smoke.ts",
    "e2e": "playwright test",
    "deploy": "pnpm build && wrangler deploy"
  }
}
```

(Merge these into the generated `package.json`, keeping the dependency versions pnpm wrote.)

- [ ] **Step 3: Write configs**

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "types": ["vite/client", "vite-plugin-pwa/client", "node"]
  },
  "include": ["src", "worker", "scripts", "tests", "e2e", "vite.config.ts", "playwright.config.ts"]
}
```

`biome.json`:

```json
{
  "$schema": "https://biomejs.dev/schemas/2.0.0/schema.json",
  "files": { "ignore": ["dist", "node_modules", ".wrangler", "test-results", "playwright-report"] },
  "linter": { "enabled": true, "rules": { "recommended": true } },
  "formatter": { "enabled": true, "indentStyle": "space", "indentWidth": 2 }
}
```

`.gitignore`:

```
node_modules/
dist/
.wrangler/
.dev.vars
coverage/
test-results/
playwright-report/
.DS_Store
```

`vite.config.ts`:

```ts
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { "/api": "http://127.0.0.1:8787" },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "worker/**/*.test.ts", "tests/**/*.test.ts"],
  },
});
```

`wrangler.toml`:

```toml
name = "quiosco"
main = "worker/index.ts"
compatibility_date = "2026-09-01"
compatibility_flags = ["global_fetch_strictly_public"]

[assets]
directory = "./dist"
binding = "ASSETS"
not_found_handling = "single-page-application"
run_worker_first = true

[[kv_namespaces]]
binding = "BUDGET"
id = "00000000000000000000000000000000"

[vars]
ALLOWED_MODELS = "deepseek-v4.1-flash,big-pickle,space-bunny-free,longcat-2.5-preview-free,mimo-v2.6-flash-free,nemotron-3.5-lightning-free,gemini-3.5-flash-lite"
DAILY_CHUNK_BUDGET = "200"

[dev]
port = 8787
```

(The all-zeros KV id is a local-dev placeholder; deploy replaces it with the
real id from `wrangler kv namespace create BUDGET`, per the README checklist.)

- [ ] **Step 4: Minimal app + placeholder worker**

`index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <meta name="theme-color" content="#0f172a" />
    <title>Quiosco</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`src/main.tsx`:

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("missing #root");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

`src/App.tsx`:

```tsx
export default function App() {
  return <main className="app">Quiosco</main>;
}
```

`src/styles.css`:

```css
:root {
  --bg: #ffffff;
  --fg: #0f172a;
  --muted: #64748b;
  --card: #f8fafc;
  --accent: #2563eb;
  --danger: #dc2626;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0f172a;
    --fg: #e2e8f0;
    --muted: #94a3b8;
    --card: #1e293b;
    --accent: #60a5fa;
    --danger: #f87171;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.5 system-ui, sans-serif; }
.app { max-width: 720px; margin: 0 auto; padding: 16px; }
```

`worker/index.ts` (placeholder, real handler lands in Task 10):

```ts
export default {
  async fetch(): Promise<Response> {
    return new Response("not implemented", { status: 501 });
  },
};
```

- [ ] **Step 5: Verify**

Run: `pnpm typecheck && pnpm lint && pnpm exec vitest run --passWithNoTests`
Expected: typecheck/lint pass; vitest runs 0 tests cleanly. Then `pnpm build` succeeds and `dist/index.html` exists. `wrangler dev` boots without config errors (Ctrl-C after it prints the local URL).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: scaffold Vite React PWA + Cloudflare Worker toolchain"
```

---

### Task 2: Share classification, URL normalization, title derivation

**Files:**
- Create: `src/lib/types.ts`
- Create: `src/lib/share.ts`, `src/lib/share.test.ts`
- Create: `src/lib/url.ts`, `src/lib/url.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `classifyShare(payload: SharePayload): ShareClassification`, `firstUrl(text: string): string | null`, `deriveTitle(input: { extractedTitle: string | null; sharedTitle: string; text: string; url: string | null }): string`, `normalizeUrl(raw: string): string | null`, and the shared types `Article`, `Settings`, `SharePayload`, `Rung`, `Via`, `ArticleStatus`, `TranslationStatus`.

- [ ] **Step 1: Write `src/lib/types.ts`**

```ts
export type ArticleStatus = "unread" | "read" | "archived";
export type TranslationStatus = "pending" | "running" | "done" | "error";
export type Rung = "direct" | "googlebot" | "jina" | "wayback" | "archive_ph";
export type Via = Rung | "manual";

export interface Article {
  id: string;
  url: string | null;
  title: string;
  site: string | null;
  text: string;
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

export interface Settings {
  targetLanguage: string;
  rules: string;
  model: string;
  appToken: string;
  autoTranslate: boolean;
}

export interface SharePayload {
  title: string;
  text: string;
  url: string;
  receivedAt: number;
}
```

- [ ] **Step 2: Write the failing tests**

`src/lib/share.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { classifyShare, deriveTitle, firstUrl } from "./share";
import type { SharePayload } from "./types";

const payload = (partial: Partial<SharePayload>): SharePayload => ({
  title: "",
  text: "",
  url: "",
  receivedAt: 0,
  ...partial,
});

const longText = (n: number) => "palabra ".repeat(Math.ceil(n / 8)).slice(0, n);

describe("firstUrl", () => {
  it("finds the first http(s) URL", () => {
    expect(firstUrl("hello https://example.com/a?b=1 world")).toBe("https://example.com/a?b=1");
  });
  it("returns null when there is none", () => {
    expect(firstUrl("no links here")).toBeNull();
  });
});

describe("classifyShare", () => {
  it("detects URL mode from the url param alone", () => {
    const result = classifyShare(payload({ url: "https://elpais.com/a.html" }));
    expect(result).toEqual({ mode: "url", url: "https://elpais.com/a.html", title: "" });
  });

  it("detects URL mode when Chrome puts the URL in text", () => {
    const result = classifyShare(payload({ text: "https://elpais.com/a.html", title: "Un titular" }));
    expect(result).toEqual({ mode: "url", url: "https://elpais.com/a.html", title: "Un titular" });
  });

  it("detects URL mode when text is just the title", () => {
    const result = classifyShare(
      payload({ url: "https://elpais.com/a.html", text: "Un titular", title: "Un titular" }),
    );
    expect(result.mode).toBe("url");
  });

  it("uses TEXT mode for long text with an attached URL", () => {
    const text = `${longText(500)} https://elpais.com/a.html`;
    const result = classifyShare(payload({ url: "https://elpais.com/a.html", text }));
    expect(result.mode).toBe("text");
    if (result.mode === "text") {
      expect(result.url).toBe("https://elpais.com/a.html");
      expect(result.text).not.toContain("https://elpais.com/a.html");
      expect(result.text.length).toBeGreaterThanOrEqual(400);
    }
  });

  it("uses TEXT mode for long text without a URL", () => {
    const result = classifyShare(payload({ text: longText(450) }));
    expect(result.mode).toBe("text");
    if (result.mode === "text") expect(result.url).toBeNull();
  });

  it("treats exactly 400 chars as text and 399 as manual", () => {
    expect(classifyShare(payload({ text: longText(400) })).mode).toBe("text");
    expect(classifyShare(payload({ text: longText(399) })).mode).toBe("manual");
  });

  it("falls back to manual for short non-URL text", () => {
    const result = classifyShare(payload({ text: "mira esto", title: "t" }));
    expect(result).toEqual({ mode: "manual", text: "mira esto", title: "t", url: null });
  });

  it("falls back to manual when everything is empty", () => {
    expect(classifyShare(payload({})).mode).toBe("manual");
  });
});

describe("deriveTitle", () => {
  it("prefers the extracted title", () => {
    expect(deriveTitle({ extractedTitle: "Extracted", sharedTitle: "Shared", text: "x", url: null })).toBe(
      "Extracted",
    );
  });
  it("falls back to the shared title", () => {
    expect(deriveTitle({ extractedTitle: null, sharedTitle: "Shared", text: "x", url: null })).toBe("Shared");
  });
  it("falls back to the first non-empty line", () => {
    expect(deriveTitle({ extractedTitle: null, sharedTitle: "", text: "\nFirst line\nrest", url: null })).toBe(
      "First line",
    );
  });
  it("falls back to the hostname", () => {
    expect(
      deriveTitle({ extractedTitle: null, sharedTitle: "", text: "", url: "https://elpais.com/a.html" }),
    ).toBe("elpais.com");
  });
  it("returns Untitled when nothing is available", () => {
    expect(deriveTitle({ extractedTitle: null, sharedTitle: "", text: "", url: null })).toBe("Untitled");
  });
});
```

`src/lib/url.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { normalizeUrl } from "./url";

describe("normalizeUrl", () => {
  it("strips fragments", () => {
    expect(normalizeUrl("https://elpais.com/a.html#section")).toBe("https://elpais.com/a.html");
  });

  it("strips utm and known tracking params but keeps meaningful ones", () => {
    expect(
      normalizeUrl("https://elpais.com/a.html?utm_source=x&fbclid=y&ssm=z&emk=q&page=2"),
    ).toBe("https://elpais.com/a.html?page=2");
  });

  it("maps ABC _amp variants onto the canonical URL", () => {
    expect(normalizeUrl("https://www.abc.es/espana/x-nt_amp.html")).toBe(
      "https://www.abc.es/espana/x-nt.html",
    );
  });

  it("removes ?amp", () => {
    expect(normalizeUrl("https://www.lavanguardia.com/a.html?amp")).toBe(
      "https://www.lavanguardia.com/a.html",
    );
  });

  it("rejects non-http(s) and invalid URLs", () => {
    expect(normalizeUrl("ftp://example.com")).toBeNull();
    expect(normalizeUrl("not a url")).toBeNull();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm vitest run src/lib/share.test.ts src/lib/url.test.ts`
Expected: FAIL — modules `./share` / `./url` not found.

- [ ] **Step 4: Implement `src/lib/share.ts`**

```ts
import type { SharePayload } from "./types";

export const TEXT_MIN_CHARS = 400;

export type ShareClassification =
  | { mode: "url"; url: string; title: string }
  | { mode: "text"; text: string; title: string; url: string | null }
  | { mode: "manual"; text: string; title: string; url: string | null };

const URL_RE = /https?:\/\/[^\s<>"')\]]+/i;

export function firstUrl(text: string): string | null {
  const match = text.match(URL_RE);
  return match ? match[0] : null;
}

export function classifyShare(payload: SharePayload): ShareClassification {
  const text = payload.text.trim();
  const title = payload.title.trim();
  const url = payload.url.trim() || firstUrl(text) || "";

  if (!url) {
    if (text.length >= TEXT_MIN_CHARS) return { mode: "text", text, title, url: null };
    return { mode: "manual", text, title, url: null };
  }

  const remainder = text.split(url).join(" ").replace(/\s+/g, " ").trim();
  const remainderNoTitle = title && remainder === title ? "" : remainder;

  if (remainderNoTitle.length === 0) return { mode: "url", url, title };
  if (remainderNoTitle.length >= TEXT_MIN_CHARS) {
    return { mode: "text", text: remainderNoTitle, title, url };
  }
  return { mode: "manual", text: remainderNoTitle, title, url };
}

export function deriveTitle(input: {
  extractedTitle: string | null;
  sharedTitle: string;
  text: string;
  url: string | null;
}): string {
  const extracted = input.extractedTitle?.trim();
  if (extracted) return extracted.slice(0, 200);
  const shared = input.sharedTitle.trim();
  if (shared) return shared.slice(0, 200);
  const firstLine = input.text
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (firstLine) return firstLine.slice(0, 200);
  if (input.url) {
    try {
      return new URL(input.url).hostname;
    } catch {
      /* fall through */
    }
  }
  return "Untitled";
}
```

- [ ] **Step 5: Implement `src/lib/url.ts`**

```ts
const TRACKING_PARAMS = new Set(["amp", "emk", "fbclid", "gclid", "intcmp", "s_kw", "ssm"]);

export function normalizeUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  url.hash = "";

  const params = new URLSearchParams(url.search);
  for (const key of [...params.keys()]) {
    if (/^utm_/i.test(key) || TRACKING_PARAMS.has(key.toLowerCase())) params.delete(key);
  }
  const search = params.toString();
  url.search = search ? `?${search}` : "";

  if (url.pathname.endsWith("_amp.html")) {
    url.pathname = `${url.pathname.slice(0, -"_amp.html".length)}.html`;
  }

  return url.toString();
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm vitest run src/lib/share.test.ts src/lib/url.test.ts`
Expected: PASS (all tests). Then `pnpm typecheck && pnpm lint`.

- [ ] **Step 7: Commit**

```bash
git add src/lib
git commit -m "feat(lib): share classification, url normalization, title derivation"
```

---

### Task 3: Fixtures capture + quality gate

**Files:**
- Create: `scripts/capture-fixtures.mjs`
- Create: `tests/fixtures/README.md`
- Create: `src/lib/quality.ts`, `src/lib/quality.test.ts`
- Captured (committed): `tests/fixtures/elpais.html.gz`, `tests/fixtures/elmundo.html.gz`

**Interfaces:**
- Consumes: nothing.
- Produces: `assessArticle(text: string): QualityVerdict`, `paragraphCount(text: string): number`, constants `MIN_ARTICLE_CHARS = 600`, `MIN_PARAGRAPHS = 3`, `PAYWALL_MARKERS: string[]`. Fixture files consumed by Task 4.

- [ ] **Step 1: Write the capture script**

`scripts/capture-fixtures.mjs`:

```js
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";

const TARGETS = [
  {
    name: "elpais",
    url: "https://elpais.com/economia/vivienda/2026-09-30/el-casero-tendra-que-indemnizar-con-12-mensualidades-al-inquilino-si-decide-no-renovar-el-alquiler.html",
  },
  {
    name: "elmundo",
    url: "https://www.elmundo.es/economia/vivienda/2026/09/30/6abcb33ffc6c8332128b458b.html",
  },
];

await mkdir("tests/fixtures", { recursive: true });

for (const target of TARGETS) {
  const response = await fetch(target.url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
      "Accept-Language": "es-ES,es;q=0.9",
    },
  });
  if (!response.ok) {
    throw new Error(
      `Capture failed for ${target.name} (${response.status}). Replace the URL in TARGETS with a current article from the same paper and rerun.`,
    );
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  const gz = gzipSync(bytes, { level: 9 });
  const file = `tests/fixtures/${target.name}.html.gz`;
  await writeFile(file, gz);
  const sha = createHash("sha256").update(bytes).digest("hex").slice(0, 12);
  console.log(`${file} — ${bytes.byteLength} bytes (sha256:${sha})`);
}
```

- [ ] **Step 2: Capture the fixtures**

```bash
node scripts/capture-fixtures.mjs
ls -la tests/fixtures/
```

Expected: two `.html.gz` files, each a few hundred KB. If a URL has rotted, substitute a current article from the same paper before rerunning.

- [ ] **Step 3: Write the fixtures README**

`tests/fixtures/README.md`:

```markdown
# Frozen fixtures

Captured from live pages on 2026-09-30 (see `scripts/capture-fixtures.mjs`).
These are frozen on purpose: extraction and quality-gate tests run against
real pages of the Spanish press top list (spec §3). Do not refresh them
silently; updating a fixture is a reviewed change, and the capture date goes
in the commit message.
```

- [ ] **Step 4: Write the failing quality-gate tests**

`src/lib/quality.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { assessArticle, paragraphCount } from "./quality";

const para = (chars: number) => "x".repeat(chars);
const article = (paragraphs: string[]) => paragraphs.join("\n\n");

describe("paragraphCount", () => {
  it("counts only paragraphs of at least 40 chars", () => {
    expect(paragraphCount(article([para(120), "short", para(80)]))).toBe(2);
  });
});

describe("assessArticle", () => {
  it("passes a long multi-paragraph article", () => {
    expect(assessArticle(article([para(300), para(300), para(120)])).ok).toBe(true);
  });

  it("rejects text under 600 chars", () => {
    expect(assessArticle(article([para(120), para(120), para(120)])).ok).toBe(false);
    expect(assessArticle(article([para(120), para(120), para(120)]))).toEqual({
      ok: false,
      reason: "too-short",
    });
  });

  it("rejects fewer than 3 paragraphs", () => {
    const verdict = assessArticle(article([para(400), para(400)]));
    expect(verdict).toEqual({ ok: false, reason: "too-few-paragraphs" });
  });

  it("rejects paywall markers", () => {
    const text = article([para(300), para(300), para(300), "Suscríbete para seguir leyendo"]);
    const verdict = assessArticle(text);
    expect(verdict).toEqual({ ok: false, reason: "marker" });
  });

  it("passes the boundary case of exactly 600 chars in 3 paragraphs", () => {
    expect(assessArticle(article([para(250), para(250), para(100)])).ok).toBe(true);
  });
});
```

- [ ] **Step 5: Run tests to verify they fail**

Run: `pnpm vitest run src/lib/quality.test.ts`
Expected: FAIL — `./quality` not found.

- [ ] **Step 6: Implement `src/lib/quality.ts`**

```ts
export const MIN_ARTICLE_CHARS = 600;
export const MIN_PARAGRAPHS = 3;

export const PAYWALL_MARKERS = [
  "suscríbete para seguir leyendo",
  "para seguir leyendo este",
  "suscríbete para leer",
  "subscribe to continue reading",
  "to continue reading, subscribe",
  "create a free account to continue",
  "checking your browser",
  "just a moment...",
  "enable javascript and cookies to continue",
  "datadome",
  "you have reached your article limit",
];

export type QualityVerdict =
  | { ok: true }
  | { ok: false; reason: "too-short" | "too-few-paragraphs" | "marker" };

export function paragraphCount(text: string): number {
  return text
    .split(/\n+/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length >= 40).length;
}

export function assessArticle(text: string): QualityVerdict {
  const trimmed = text.trim();
  if (trimmed.length < MIN_ARTICLE_CHARS) return { ok: false, reason: "too-short" };
  const lower = trimmed.toLowerCase();
  for (const marker of PAYWALL_MARKERS) {
    if (lower.includes(marker)) return { ok: false, reason: "marker" };
  }
  if (paragraphCount(trimmed) < MIN_PARAGRAPHS) return { ok: false, reason: "too-few-paragraphs" };
  return { ok: true };
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `pnpm vitest run src/lib/quality.test.ts`
Expected: PASS. Then `pnpm typecheck && pnpm lint`.

- [ ] **Step 8: Commit**

```bash
git add scripts tests/fixtures src/lib/quality.ts src/lib/quality.test.ts
git commit -m "feat(lib): quality gate + frozen press fixtures"
```

---

### Task 4: Extraction (charset decode + Readability)

**Files:**
- Create: `src/lib/extract.ts`, `src/lib/extract.test.ts`

**Interfaces:**
- Consumes: `assessArticle` (Task 3); fixtures from Task 3.
- Produces: `decodeHtml(bytes: Uint8Array, contentType: string | null): string`, `charsetFromContentType(contentType: string | null): string | null`, `extractArticle(html: string): ExtractedArticle | null`, interface `ExtractedArticle { title: string | null; text: string }`.

- [ ] **Step 1: Write the failing tests**

`src/lib/extract.test.ts`:

```ts
// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { assessArticle } from "./quality";
import { charsetFromContentType, decodeHtml, extractArticle } from "./extract";

// cwd-relative: Vite (vitest) rewrites import.meta.url under the jsdom
// environment, so new URL(..., import.meta.url) resolves to the wrong base.
const fixture = (name: string) =>
  new Uint8Array(gunzipSync(readFileSync(`tests/fixtures/${name}`)));

describe("charsetFromContentType", () => {
  it("extracts a charset", () => {
    expect(charsetFromContentType("text/html; charset=iso-8859-15")).toBe("iso-8859-15");
    expect(charsetFromContentType('text/html; charset="UTF-8"')).toBe("utf-8");
  });
  it("returns null without a charset", () => {
    expect(charsetFromContentType("text/html")).toBeNull();
    expect(charsetFromContentType(null)).toBeNull();
  });
});

describe("decodeHtml", () => {
  it("respects the content-type charset", () => {
    const bytes = new Uint8Array([0x63, 0x61, 0x66, 0xe9, 0x20, 0xf1]); // "café ñ" in latin-1
    expect(decodeHtml(bytes, "text/html; charset=iso-8859-15")).toBe("café ñ");
  });

  it("sniffs the meta charset when the header has none", () => {
    const html = '<html><head><meta charset="iso-8859-15"></head><body>\xf1</body></html>';
    const bytes = Uint8Array.from(html, (character) => character.charCodeAt(0) & 0xff);
    expect(decodeHtml(bytes, null)).toContain("ñ");
  });

  it("defaults to utf-8", () => {
    const bytes = new TextEncoder().encode("ñandú");
    expect(decodeHtml(bytes, "text/html")).toBe("ñandú");
  });
});

describe("extractArticle", () => {
  it("extracts an article from a synthetic paywall-overlay page", () => {
    const body = Array.from(
      { length: 5 },
      (_, i) => `<p>Párrafo número ${i} con el contenido real de la noticia, lo bastante largo.</p>`,
    ).join("");
    const html = `<html><head><title>Un titular</title></head><body><div class="paywall-overlay"></div><article>${body}</article></body></html>`;
    const result = extractArticle(html);
    expect(result?.title).toBe("Un titular");
    expect(result?.text).toContain("Párrafo número 0");
  });

  it("returns null for an empty document", () => {
    expect(extractArticle("<html><body></body></html>")).toBeNull();
  });

  it("decodes and extracts the El País fixture", () => {
    const html = decodeHtml(fixture("elpais.html.gz"), null);
    const article = extractArticle(html);
    expect(article).not.toBeNull();
    if (article) {
      expect(assessArticle(article.text).ok).toBe(true);
    }
  });

  it("decodes and extracts the El Mundo fixture (ISO-8859-15)", () => {
    const html = decodeHtml(fixture("elmundo.html.gz"), "text/html; charset=iso-8859-15");
    // Proves the ISO-8859-15 decode: mojibake would not produce these characters.
    // (No "Ã"-absence check: El Mundo's own inline ad script carries a UTF-8
    // character that decodes to "Ã" under ISO-8859-15.)
    expect(html).toMatch(/[áéíóúñ]/);
    const article = extractArticle(html);
    expect(article).not.toBeNull();
    if (article) {
      expect(assessArticle(article.text).ok).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/lib/extract.test.ts`
Expected: FAIL — `./extract` not found.

- [ ] **Step 3: Implement `src/lib/extract.ts`**

```ts
import { Readability } from "@mozilla/readability";

export interface ExtractedArticle {
  title: string | null;
  text: string;
}

const META_CHARSET_RE = /<meta[^>]+charset=["']?\s*([\w-]+)/i;
const CONTENT_TYPE_CHARSET_RE = /charset=["']?\s*([\w-]+)/i;

export function charsetFromContentType(contentType: string | null): string | null {
  if (!contentType) return null;
  return CONTENT_TYPE_CHARSET_RE.exec(contentType)?.[1]?.toLowerCase() ?? null;
}

export function decodeHtml(bytes: Uint8Array, contentType: string | null): string {
  let charset = charsetFromContentType(contentType);
  if (!charset) {
    const head = new TextDecoder("windows-1252").decode(bytes.subarray(0, 2048));
    charset = META_CHARSET_RE.exec(head)?.[1]?.toLowerCase() ?? "utf-8";
  }
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

export function extractArticle(html: string): ExtractedArticle | null {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const parsed = new Readability(doc).parse();
  if (parsed) {
    const text = blocksToText(parsed.content);
    if (text.trim().length > 0) return { title: parsed.title?.trim() || null, text };
  }
  const body = doc.body?.textContent ?? "";
  if (body.trim().length > 0) return { title: doc.title.trim() || null, text: body };
  return null;
}

// Real news pages are minified, so Readability's textContent has no line
// breaks between block elements. Join block elements with blank lines so
// paragraph-aware consumers (quality gate, chunker, translation) see the
// article's paragraph structure.
function blocksToText(contentHtml: string): string {
  const container = new DOMParser().parseFromString(contentHtml, "text/html");
  const blocks = container.querySelectorAll("p, h2, h3, h4, h5, h6, li, blockquote, pre, figcaption, td");
  if (blocks.length === 0) return container.body?.textContent?.trim() ?? "";
  return Array.from(blocks)
    .map((block) => block.textContent?.replace(/\s+/g, " ").trim() ?? "")
    .filter((text) => text.length > 0)
    .join("\n\n");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/lib/extract.test.ts`
Expected: PASS. If the synthetic overlay test fails because Readability's title extraction differs, keep `expect(result?.title).toBe("Un titular")` — Readability reads `<title>`; if it returns null, adjust the fixture HTML to include `<h1>Un titular</h1>` inside the article and assert on the text instead. Do not weaken the two real-fixture tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/extract.ts src/lib/extract.test.ts
git commit -m "feat(lib): charset-aware html decode + readability extraction"
```

---

### Task 5: Chunking + prompt builder

**Files:**
- Create: `src/lib/chunk.ts`, `src/lib/chunk.test.ts`
- Create: `src/lib/prompt.ts`, `src/lib/prompt.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `chunkText(text: string, maxChars?: number): string[]` (default 12,000), `buildSystemPrompt(input: { targetLanguage: string; rules: string }): string`.

- [ ] **Step 1: Write the failing tests**

`src/lib/chunk.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { chunkText } from "./chunk";

const normalized = (text: string) => text.replace(/\s+/g, " ").trim();
const sentence = (i: number) => `Esta es la frase número ${i} de la noticia.`;

describe("chunkText", () => {
  it("returns [] for empty text", () => {
    expect(chunkText("   ")).toEqual([]);
  });

  it("returns a single chunk when under the limit", () => {
    const text = "Un párrafo corto.";
    expect(chunkText(text)).toEqual([text]);
  });

  it("keeps exactly-maxChars text in one chunk", () => {
    const text = "a".repeat(12_000);
    expect(chunkText(text)).toHaveLength(1);
  });

  it("splits large multi-paragraph text into chunks <= maxChars", () => {
    const paragraph = Array.from({ length: 20 }, (_, i) => sentence(i)).join(" ");
    const text = Array.from({ length: 20 }, () => paragraph).join("\n\n");
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(12_000);
    expect(normalized(chunks.join("\n\n"))).toBe(normalized(text));
  });

  it("prefers paragraph boundaries", () => {
    const paragraph = "x".repeat(9_000);
    const chunks = chunkText(`${paragraph}\n\n${paragraph}\n\n${paragraph}`);
    expect(chunks).toHaveLength(3);
    for (const chunk of chunks) expect(chunk).toBe(paragraph);
  });

  it("splits a single oversized paragraph at sentence boundaries", () => {
    const text = Array.from({ length: 300 }, (_, i) => sentence(i)).join(" ");
    const chunks = chunkText(text, 1_000);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(1_000);
      expect(chunk.trimEnd().endsWith(".")).toBe(true);
    }
  });

  it("hard-slices a sentence with no punctuation", () => {
    const text = "y".repeat(25_000);
    const chunks = chunkText(text);
    expect(chunks).toHaveLength(3);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(12_000);
  });
});
```

`src/lib/prompt.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "./prompt";

describe("buildSystemPrompt", () => {
  it("includes the target language and rules", () => {
    const prompt = buildSystemPrompt({ targetLanguage: "Ukrainian", rules: "Keep legal terms." });
    expect(prompt).toContain("Ukrainian");
    expect(prompt).toContain("Keep legal terms.");
    expect(prompt).toContain("Output only the translation, no commentary.");
  });

  it("substitutes defaults for empty inputs", () => {
    const prompt = buildSystemPrompt({ targetLanguage: "", rules: "" });
    expect(prompt).toContain("English");
    expect(prompt).toContain("Rules: None.");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/lib/chunk.test.ts src/lib/prompt.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `src/lib/chunk.ts`**

```ts
export const DEFAULT_CHUNK_CHARS = 12_000;

export function chunkText(text: string, maxChars: number = DEFAULT_CHUNK_CHARS): string[] {
  const trimmed = text.trim();
  if (trimmed.length === 0) return [];

  const pieces: string[] = [];
  for (const paragraph of trimmed.split(/\n{2,}/)) {
    pieces.push(...splitToMax(paragraph, maxChars));
  }

  const chunks: string[] = [];
  let current = "";
  for (const piece of pieces) {
    const candidate = current ? `${current}\n\n${piece}` : piece;
    if (candidate.length <= maxChars) {
      current = candidate;
    } else {
      if (current) chunks.push(current);
      current = piece;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function splitToMax(paragraph: string, maxChars: number): string[] {
  if (paragraph.length <= maxChars) return [paragraph];
  const out: string[] = [];
  let current = "";
  for (const sentence of paragraph.split(/(?<=[.!?])\s+/)) {
    if (sentence.length > maxChars) {
      if (current) {
        out.push(current);
        current = "";
      }
      for (let i = 0; i < sentence.length; i += maxChars) {
        out.push(sentence.slice(i, i + maxChars));
      }
      continue;
    }
    const candidate = current ? `${current} ${sentence}` : sentence;
    if (candidate.length <= maxChars) {
      current = candidate;
    } else {
      out.push(current);
      current = sentence;
    }
  }
  if (current) out.push(current);
  return out;
}
```

- [ ] **Step 4: Implement `src/lib/prompt.ts`**

```ts
export function buildSystemPrompt(input: { targetLanguage: string; rules: string }): string {
  const language = input.targetLanguage.trim() || "English";
  const rules = input.rules.trim() || "None.";
  return `Translate the user's message to ${language}. Rules: ${rules} Preserve paragraph structure and quotes. Output only the translation, no commentary.`;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run src/lib/chunk.test.ts src/lib/prompt.test.ts`
Expected: PASS. Then `pnpm typecheck && pnpm lint`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/chunk.ts src/lib/chunk.test.ts src/lib/prompt.ts src/lib/prompt.test.ts
git commit -m "feat(lib): paragraph-aware chunker + prompt builder"
```

---

### Task 6: Settings + IndexedDB store

**Files:**
- Create: `src/lib/settings.ts`, `src/lib/settings.test.ts`
- Create: `src/lib/store.ts`, `src/lib/store.test.ts`

**Interfaces:**
- Consumes: `Article`, `Settings` (Task 2).
- Produces: `DEFAULT_SETTINGS: Settings`, `loadSettings(storage?): Settings`, `saveSettings(settings, storage?): void`; `createStore(dbName?: string): Promise<ArticleStore>` with methods `list(): Promise<Article[]>` (newest first), `get(id)`, `put(article)`, `update(id, patch): Promise<Article>`, `remove(id)`, `findByUrl(url)`, `close()`.

- [ ] **Step 1: Write the failing tests**

`src/lib/settings.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from "./settings";

describe("settings", () => {
  it("round-trips through storage", () => {
    saveSettings({ ...DEFAULT_SETTINGS, targetLanguage: "Spanish", model: "big-pickle" });
    const loaded = loadSettings();
    expect(loaded.targetLanguage).toBe("Spanish");
    expect(loaded.model).toBe("big-pickle");
  });

  it("returns defaults for missing or corrupt data", () => {
    localStorage.clear();
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    localStorage.setItem("quiosco.settings.v1", "{oops");
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("merges partial data with defaults", () => {
    localStorage.setItem("quiosco.settings.v1", JSON.stringify({ rules: "Be terse." }));
    const loaded = loadSettings();
    expect(loaded.rules).toBe("Be terse.");
    expect(loaded.model).toBe(DEFAULT_SETTINGS.model);
    expect(loaded.autoTranslate).toBe(true);
  });
});
```

`src/lib/store.test.ts`:

```ts
import "fake-indexeddb/auto";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createStore } from "./store";
import type { Article } from "./types";

const makeArticle = (patch: Partial<Article> = {}): Article => ({
  id: randomUUID(),
  url: "https://example.com/a",
  title: "Título",
  site: "example.com",
  text: "texto",
  via: "direct",
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

describe("store", () => {
  it("puts, gets, and lists newest first", async () => {
    const store = await createStore(`test-${randomUUID()}`);
    const first = makeArticle({ createdAt: 1000 });
    const second = makeArticle({ createdAt: 2000 });
    await store.put(first);
    await store.put(second);
    expect((await store.list()).map((a) => a.id)).toEqual([second.id, first.id]);
    expect((await store.get(first.id))?.title).toBe("Título");
    store.close();
  });

  it("updates with a patch and bumps updatedAt", async () => {
    const store = await createStore(`test-${randomUUID()}`);
    const article = makeArticle({ updatedAt: 1 });
    await store.put(article);
    const updated = await store.update(article.id, { status: "read" });
    expect(updated.status).toBe("read");
    expect(updated.updatedAt).toBeGreaterThan(1);
    store.close();
  });

  it("throws on updating a missing article", async () => {
    const store = await createStore(`test-${randomUUID()}`);
    await expect(store.update("missing", { status: "read" })).rejects.toThrow("article not found");
    store.close();
  });

  it("finds by url and removes", async () => {
    const store = await createStore(`test-${randomUUID()}`);
    const article = makeArticle();
    await store.put(article);
    expect((await store.findByUrl("https://example.com/a"))?.id).toBe(article.id);
    await store.remove(article.id);
    expect(await store.get(article.id)).toBeUndefined();
    store.close();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/lib/settings.test.ts src/lib/store.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `src/lib/settings.ts`**

```ts
import type { Settings } from "./types";

const SETTINGS_KEY = "quiosco.settings.v1";

export const DEFAULT_SETTINGS: Settings = {
  targetLanguage: "English",
  rules: "",
  model: "deepseek-v4.1-flash",
  appToken: "",
  autoTranslate: true,
};

export function loadSettings(storage: Pick<Storage, "getItem"> = localStorage): Settings {
  try {
    const raw = storage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      targetLanguage:
        typeof parsed.targetLanguage === "string" ? parsed.targetLanguage : DEFAULT_SETTINGS.targetLanguage,
      rules: typeof parsed.rules === "string" ? parsed.rules : DEFAULT_SETTINGS.rules,
      model: typeof parsed.model === "string" && parsed.model.trim() ? parsed.model : DEFAULT_SETTINGS.model,
      appToken: typeof parsed.appToken === "string" ? parsed.appToken : DEFAULT_SETTINGS.appToken,
      autoTranslate:
        typeof parsed.autoTranslate === "boolean" ? parsed.autoTranslate : DEFAULT_SETTINGS.autoTranslate,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: Settings, storage: Pick<Storage, "setItem"> = localStorage): void {
  storage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}
```

- [ ] **Step 4: Implement `src/lib/store.ts`**

```ts
import { type DBSchema, type IDBPDatabase, openDB } from "idb";
import type { Article } from "./types";

interface QuioscoDB extends DBSchema {
  articles: {
    key: string;
    value: Article;
    indexes: { createdAt: number; url: string };
  };
}

export interface ArticleStore {
  list(): Promise<Article[]>;
  get(id: string): Promise<Article | undefined>;
  put(article: Article): Promise<void>;
  update(id: string, patch: Partial<Article>): Promise<Article>;
  remove(id: string): Promise<void>;
  findByUrl(url: string): Promise<Article | undefined>;
  close(): void;
}

export async function createStore(dbName = "quiosco"): Promise<ArticleStore> {
  const db = await openDB<QuioscoDB>(dbName, 1, {
    upgrade(database: IDBPDatabase<QuioscoDB>) {
      const store = database.createObjectStore("articles", { keyPath: "id" });
      store.createIndex("createdAt", "createdAt");
      store.createIndex("url", "url");
    },
  });

  return {
    async list() {
      const all = await db.getAllFromIndex("articles", "createdAt");
      return all.reverse();
    },
    get(id) {
      return db.get("articles", id);
    },
    async put(article) {
      await db.put("articles", article);
    },
    async update(id, patch) {
      const existing = await db.get("articles", id);
      if (!existing) throw new Error(`article not found: ${id}`);
      const updated: Article = { ...existing, ...patch, updatedAt: Date.now() };
      await db.put("articles", updated);
      return updated;
    },
    remove(id) {
      return db.delete("articles", id);
    },
    async findByUrl(url) {
      const matches = await db.getAllFromIndex("articles", "url", url);
      return matches[0];
    },
    close() {
      db.close();
    },
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run src/lib/settings.test.ts src/lib/store.test.ts`
Expected: PASS. Then `pnpm typecheck && pnpm lint`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/settings.ts src/lib/settings.test.ts src/lib/store.ts src/lib/store.test.ts
git commit -m "feat(lib): settings storage + indexeddb article store"
```

---

### Task 7: API client

**Files:**
- Modify: `src/lib/types.ts` (add `RungResponse`, `TranslateRequest`)
- Create: `src/lib/api.ts`, `src/lib/api.test.ts`

**Interfaces:**
- Consumes: `Rung` (Task 2).
- Produces: `createApi(options: { token: string; fetchFn?: typeof fetch }): ApiClient` with `fetchRung(rung: Rung, url: string): Promise<RungResponse>`, `translate(request: TranslateRequest): Promise<string>`, `health(): Promise<boolean>`; error classes `ApiError { status }`, `AuthError extends ApiError`, `QuotaError extends ApiError`.

- [ ] **Step 1: Extend `src/lib/types.ts`**

Append to `src/lib/types.ts`:

```ts
export interface RungResponse {
  bytes: Uint8Array;
  contentType: string | null;
  kind: "html" | "markdown";
  via: Rung;
  finalUrl: string | null;
}

export interface TranslateRequest {
  model: string;
  system: string;
  text: string;
}
```

- [ ] **Step 2: Write the failing tests**

`src/lib/api.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { ApiError, AuthError, QuotaError, createApi } from "./api";

describe("createApi", () => {
  it("fetchRung sends the bearer token and maps the response", async () => {
    const fetchFn = vi.fn(async () =>
      new Response(new Uint8Array([1, 2, 3]), {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "x-quiosco-kind": "html",
          "x-quiosco-final-url": "https://example.com/final",
        },
      }),
    );
    const api = createApi({ token: "secret", fetchFn: fetchFn as unknown as typeof fetch });
    const result = await api.fetchRung("direct", "https://example.com/a?b=1");

    expect(fetchFn).toHaveBeenCalledWith(
      "/api/fetch?mode=direct&url=https%3A%2F%2Fexample.com%2Fa%3Fb%3D1",
      { headers: { Authorization: "Bearer secret" } },
    );
    expect(result.kind).toBe("html");
    expect(result.finalUrl).toBe("https://example.com/final");
    expect(Array.from(result.bytes)).toEqual([1, 2, 3]);
  });

  it("fetchRung detects markdown kinds", async () => {
    const fetchFn = vi.fn(async () => new Response("md", { headers: { "x-quiosco-kind": "markdown" } }));
    const api = createApi({ token: "t", fetchFn: fetchFn as unknown as typeof fetch });
    expect((await api.fetchRung("jina", "https://example.com")).kind).toBe("markdown");
  });

  it("translate posts JSON and returns the text", async () => {
    const fetchFn = vi.fn(async () =>
      new Response(JSON.stringify({ text: "hola" }), { headers: { "content-type": "application/json" } }),
    );
    const api = createApi({ token: "secret", fetchFn: fetchFn as unknown as typeof fetch });
    await expect(api.translate({ model: "m", system: "s", text: "t" })).resolves.toBe("hola");

    const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ Authorization: "Bearer secret", "Content-Type": "application/json" });
  });

  it("maps 401/429/other statuses to typed errors", async () => {
    const make = (status: number) =>
      createApi({
        token: "t",
        fetchFn: (async () => new Response("", { status })) as unknown as typeof fetch,
      });
    await expect(make(401).fetchRung("direct", "https://e.com")).rejects.toBeInstanceOf(AuthError);
    await expect(make(429).fetchRung("direct", "https://e.com")).rejects.toBeInstanceOf(QuotaError);
    await expect(make(502).fetchRung("direct", "https://e.com")).rejects.toBeInstanceOf(ApiError);
  });

  it("health resolves true on 200", async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ ok: true })));
    const api = createApi({ token: "t", fetchFn: fetchFn as unknown as typeof fetch });
    await expect(api.health()).resolves.toBe(true);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm vitest run src/lib/api.test.ts`
Expected: FAIL — `./api` not found.

- [ ] **Step 4: Implement `src/lib/api.ts`**

```ts
import type { Rung, RungResponse, TranslateRequest } from "./types";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export class AuthError extends ApiError {
  constructor(message = "unauthorized") {
    super(message, 401);
    this.name = "AuthError";
  }
}

export class QuotaError extends ApiError {
  constructor(message = "daily budget exceeded") {
    super(message, 429);
    this.name = "QuotaError";
  }
}

export interface ApiClient {
  fetchRung(rung: Rung, url: string): Promise<RungResponse>;
  translate(request: TranslateRequest): Promise<string>;
  health(): Promise<boolean>;
}

export function createApi(options: { token: string; fetchFn?: typeof fetch }): ApiClient {
  const fetchFn = options.fetchFn ?? fetch;
  const authHeaders = { Authorization: `Bearer ${options.token}` };

  async function ensureOk(response: Response): Promise<Response> {
    if (response.status === 401) throw new AuthError();
    if (response.status === 429) throw new QuotaError();
    if (!response.ok) throw new ApiError(`request failed: ${response.status}`, response.status);
    return response;
  }

  return {
    async fetchRung(rung, url) {
      const response = await ensureOk(
        await fetchFn(`/api/fetch?mode=${rung}&url=${encodeURIComponent(url)}`, { headers: authHeaders }),
      );
      return {
        bytes: new Uint8Array(await response.arrayBuffer()),
        contentType: response.headers.get("content-type"),
        kind: response.headers.get("x-quiosco-kind") === "markdown" ? "markdown" : "html",
        via: rung,
        finalUrl: response.headers.get("x-quiosco-final-url"),
      };
    },

    async translate(request) {
      const response = await ensureOk(
        await fetchFn("/api/translate", {
          method: "POST",
          headers: { ...authHeaders, "Content-Type": "application/json" },
          body: JSON.stringify(request),
        }),
      );
      const data = (await response.json()) as { text?: unknown };
      if (typeof data.text !== "string") throw new ApiError("malformed translate response", 502);
      return data.text;
    },

    async health() {
      await ensureOk(await fetchFn("/api/health", { headers: authHeaders }));
      return true;
    },
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run src/lib/api.test.ts`
Expected: PASS. Then `pnpm typecheck && pnpm lint`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/types.ts src/lib/api.ts src/lib/api.test.ts
git commit -m "feat(lib): authenticated api client with typed errors"
```

---

### Task 8: Ladder + translation runner

**Files:**
- Create: `src/lib/ladder.ts`, `src/lib/ladder.test.ts`
- Create: `src/lib/translator.ts`, `src/lib/translator.test.ts`

**Interfaces:**
- Consumes: `RungResponse`, `TranslateRequest` (Task 7 additions to types), `decodeHtml`/`extractArticle` (Task 4), `assessArticle` (Task 3), `chunkText` (Task 5), `buildSystemPrompt` (Task 5).
- Produces: `LADDER_ORDER: Rung[]`, `climbLadder(url, fetchRung): Promise<LadderResult>`, `LadderError { attempts, partialText }`, `FetchRung`; `runTranslation(options): Promise<{ translation; totalChunks }>`, `TranslationError { translatedChunks; totalChunks }`, `RunTranslationOptions`, `TranslationSettings`, `TranslationProgress`.

- [ ] **Step 1: Write the failing ladder tests**

`src/lib/ladder.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { LadderError, climbLadder } from "./ladder";
import type { Rung, RungResponse } from "./types";

const paragraph = (n: number) =>
  `Párrafo ${n}: este es el contenido real del artículo, con longitud suficiente para contar como párrafo válido en la pasarela de calidad.`;

const goodHtml = `<html><head><title>Buen titular</title></head><body><article>${[0, 1, 2, 3, 4, 5]
  .map((n) => `<p>${paragraph(n)}</p>`)
  .join("\n")}</article></body></html>`;

const shortHtml = "<html><body><p>Teaser corto.</p></body></html>";

const htmlResponse = (html: string, via: Rung): RungResponse => ({
  bytes: new TextEncoder().encode(html),
  contentType: "text/html; charset=utf-8",
  kind: "html",
  via,
  finalUrl: "https://example.com/final",
});

describe("climbLadder", () => {
  it("escalates past a failing rung and records attempts", async () => {
    const fetchRung = async (rung: Rung): Promise<RungResponse> =>
      rung === "googlebot" ? htmlResponse(goodHtml, rung) : htmlResponse(shortHtml, rung);
    const result = await climbLadder("https://example.com/a", fetchRung);
    expect(result.via).toBe("googlebot");
    expect(result.article.title).toBe("Buen titular");
    expect(result.attempts.map((a) => a.rung)).toEqual(["direct", "googlebot"]);
    expect(result.attempts[0]).toMatchObject({ ok: false, reason: "too-short" });
    expect(result.attempts[1]).toMatchObject({ ok: true });
  });

  it("supports the jina markdown rung and strips jina front matter", async () => {
    const markdown = `Title: Algo\n\nURL Source: https://example.com\n\nMarkdown Content: ${[0, 1, 2, 3, 4, 5]
      .map((n) => paragraph(n))
      .join("\n\n")}`;
    const fetchRung = async (rung: Rung): Promise<RungResponse> => {
      if (rung === "jina") {
        return {
          bytes: new TextEncoder().encode(markdown),
          contentType: "text/plain; charset=utf-8",
          kind: "markdown",
          via: rung,
          finalUrl: null,
        };
      }
      return htmlResponse(shortHtml, rung);
    };
    const result = await climbLadder("https://example.com/a", fetchRung);
    expect(result.via).toBe("jina");
    expect(result.article.text).toContain("Párrafo 0");
    expect(result.article.text).not.toContain("URL Source:");
  });

  it("throws LadderError with attempts and the longest partial text", async () => {
    const fetchRung = async (rung: Rung): Promise<RungResponse> =>
      rung === "direct" ? htmlResponse(`<html><body><p>${"x".repeat(900)}</p></body></html>`, rung) : htmlResponse(shortHtml, rung);
    const error = await climbLadder("https://example.com/a", fetchRung).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LadderError);
    const ladderError = error as LadderError;
    expect(ladderError.attempts).toHaveLength(5);
    expect(ladderError.partialText).toContain("xxxx");
  });

  it("records thrown errors as failed attempts", async () => {
    const fetchRung = async (): Promise<RungResponse> => {
      throw new Error("boom");
    };
    const error = (await climbLadder("https://example.com/a", fetchRung).catch((e: unknown) => e)) as LadderError;
    expect(error.attempts.every((attempt) => !attempt.ok && attempt.reason === "boom")).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/lib/ladder.test.ts`
Expected: FAIL — `./ladder` not found.

- [ ] **Step 3: Implement `src/lib/ladder.ts`**

```ts
import { decodeHtml, extractArticle, type ExtractedArticle } from "./extract";
import { assessArticle } from "./quality";
import type { Rung, RungResponse } from "./types";

export const LADDER_ORDER: Rung[] = ["direct", "googlebot", "jina", "wayback", "archive_ph"];

export type FetchRung = (rung: Rung, url: string) => Promise<RungResponse>;

export interface LadderAttempt {
  rung: Rung;
  ok: boolean;
  reason?: string;
}

export interface LadderResult {
  article: ExtractedArticle;
  via: Rung;
  finalUrl: string | null;
  attempts: LadderAttempt[];
}

export class LadderError extends Error {
  constructor(
    readonly attempts: LadderAttempt[],
    readonly partialText: string | null,
  ) {
    super("All extraction rungs failed");
    this.name = "LadderError";
  }
}

function stripJinaFrontMatter(text: string): string {
  const marker = "Markdown Content:";
  const index = text.indexOf(marker);
  const body = index >= 0 ? text.slice(index + marker.length) : text;
  return body.trim();
}

export async function climbLadder(url: string, fetchRung: FetchRung): Promise<LadderResult> {
  const attempts: LadderAttempt[] = [];
  let partialText: string | null = null;

  for (const rung of LADDER_ORDER) {
    try {
      const response = await fetchRung(rung, url);
      const article: ExtractedArticle | null =
        response.kind === "markdown"
          ? {
              title: null,
              text: stripJinaFrontMatter(decodeHtml(response.bytes, response.contentType ?? "text/plain; charset=utf-8")),
            }
          : extractArticle(decodeHtml(response.bytes, response.contentType));

      if (!article || article.text.trim().length === 0) {
        attempts.push({ rung, ok: false, reason: "no-content" });
        continue;
      }
      if (!partialText || article.text.length > partialText.length) partialText = article.text;

      const verdict = assessArticle(article.text);
      if (!verdict.ok) {
        attempts.push({ rung, ok: false, reason: verdict.reason });
        continue;
      }
      attempts.push({ rung, ok: true });
      return { article, via: rung, finalUrl: response.finalUrl, attempts };
    } catch (error) {
      attempts.push({ rung, ok: false, reason: error instanceof Error ? error.message : String(error) });
    }
  }

  throw new LadderError(attempts, partialText);
}
```

- [ ] **Step 4: Write the failing translator tests**

`src/lib/translator.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { TranslationError, runTranslation } from "./translator";

const settings = { targetLanguage: "English", rules: "Be terse.", model: "deepseek-v4.1-flash" };
const longText = (n: number) => Array.from({ length: n }, (_, i) => `Frase número ${i}.`).join(" ");

describe("runTranslation", () => {
  it("translates a single chunk and reports progress", async () => {
    const onProgress = vi.fn();
    const result = await runTranslation({
      text: "Hola mundo.",
      settings,
      translate: async () => "Hello world.",
      onProgress,
    });
    expect(result.translation).toBe("Hello world.");
    expect(result.totalChunks).toBe(1);
    expect(onProgress).toHaveBeenCalledWith({ translatedChunks: 1, totalChunks: 1, translation: "Hello world." });
  });

  it("joins multiple chunks with a blank line", async () => {
    const translate = vi.fn(async (request: { text: string }) => `TR(${request.text.slice(0, 12)})`);
    const result = await runTranslation({ text: longText(4000), settings, translate });
    expect(result.totalChunks).toBeGreaterThan(1);
    expect(result.translation.split("\n\n")).toHaveLength(result.totalChunks);
    expect(translate).toHaveBeenCalledTimes(result.totalChunks);
  });

  it("retries a chunk before failing", async () => {
    let call = 0;
    const translate = async () => {
      call += 1;
      if (call === 1) throw new Error("network");
      return "ok";
    };
    const result = await runTranslation({ text: "Corto.", settings, translate, retries: 1 });
    expect(result.translation).toBe("ok");
    expect(call).toBe(2);
  });

  it("throws TranslationError with resume position when a chunk keeps failing", async () => {
    const translate = vi.fn(async (request: { text: string }) => {
      if (request.text.includes("segundo")) throw new Error("boom");
      return "primero";
    });
    const text = `${"primero ".repeat(1200)}\n\n${"segundo bloque ".repeat(500)}`;
    const error = (await runTranslation({ text, settings, translate, retries: 0 }).catch((e: unknown) => e)) as TranslationError;
    expect(error).toBeInstanceOf(TranslationError);
    expect(error.translatedChunks).toBe(1);
    expect(error.totalChunks).toBe(2);
  });

  it("resumes from the stored chunk position", async () => {
    const translate = vi.fn(async () => "segunda parte");
    const text = `${"primero ".repeat(1200)}\n\n${"segundo ".repeat(1200)}`;
    const result = await runTranslation({
      text,
      settings,
      translate,
      existingTranslation: "primera parte",
      translatedChunks: 1,
    });
    expect(result.translation).toBe("primera parte\n\nsegunda parte");
    expect(translate).toHaveBeenCalledTimes(1);
  });

  it("does not re-translate when the progress callback fails", async () => {
    const translate = vi.fn(async () => "uno");
    const onProgress = vi.fn(async () => {
      throw new Error("persist failed");
    });
    await expect(runTranslation({ text: "Corto.", settings, translate, onProgress })).rejects.toThrow(
      "persist failed",
    );
    expect(translate).toHaveBeenCalledTimes(1);
  });
});
```


- [ ] **Step 5: Run tests to verify they fail**

Run: `pnpm vitest run src/lib/translator.test.ts`
Expected: FAIL — `./translator` not found.

- [ ] **Step 6: Implement `src/lib/translator.ts`**

```ts
import { chunkText } from "./chunk";
import { buildSystemPrompt } from "./prompt";
import type { TranslateRequest } from "./types";

export interface TranslationSettings {
  targetLanguage: string;
  rules: string;
  model: string;
}

export interface TranslationProgress {
  translatedChunks: number;
  totalChunks: number;
  translation: string;
}

export class TranslationError extends Error {
  constructor(
    message: string,
    readonly translatedChunks: number,
    readonly totalChunks: number,
  ) {
    super(message);
    this.name = "TranslationError";
  }
}

export interface RunTranslationOptions {
  text: string;
  settings: TranslationSettings;
  translate: (request: TranslateRequest) => Promise<string>;
  existingTranslation?: string;
  translatedChunks?: number;
  totalChunks?: number;
  retries?: number;
  onProgress?: (progress: TranslationProgress) => Promise<void> | void;
}

export async function runTranslation(
  options: RunTranslationOptions,
): Promise<{ translation: string; totalChunks: number }> {
  const chunks = chunkText(options.text);
  if (chunks.length === 0) {
    return { translation: options.existingTranslation ?? "", totalChunks: 0 };
  }

  const totalChunks = options.totalChunks ?? chunks.length;
  const maxAttempts = (options.retries ?? 2) + 1;
  const system = buildSystemPrompt({
    targetLanguage: options.settings.targetLanguage,
    rules: options.settings.rules,
  });

  let translation = options.existingTranslation ?? "";
  let translatedChunks = options.translatedChunks ?? 0;

  for (let index = translatedChunks; index < chunks.length; index += 1) {
    let lastError: unknown = null;
    let done = false;
    for (let attempt = 1; attempt <= maxAttempts && !done; attempt += 1) {
      try {
        const output = (
          await options.translate({ model: options.settings.model, system, text: chunks[index] ?? "" })
        ).trim();
        if (!output) throw new Error("empty translation");
        translation = translation ? `${translation}\n\n${output}` : output;
        translatedChunks = index + 1;
        done = true;
      } catch (error) {
        lastError = error;
      }
    }
    if (!done) {
      throw new TranslationError(
        lastError instanceof Error ? lastError.message : String(lastError),
        translatedChunks,
        totalChunks,
      );
    }
    // Progress persistence lives outside the retry loop: a failing callback
    // must not trigger a re-translation (which would duplicate the chunk).
    await options.onProgress?.({ translatedChunks, totalChunks, translation });
  }

  return { translation, totalChunks };
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `pnpm vitest run src/lib/ladder.test.ts src/lib/translator.test.ts`
Expected: PASS. Then `pnpm typecheck && pnpm lint` and the full suite `pnpm test`.

- [ ] **Step 8: Commit**

```bash
git add src/lib/ladder.ts src/lib/ladder.test.ts src/lib/translator.ts src/lib/translator.test.ts
git commit -m "feat(lib): extraction ladder + resumable translation runner"
```

---

### Task 9: Share payload, PWA manifest, service worker, icons

**Files:**
- Create: `src/lib/sharePayload.ts`, `src/lib/sharePayload.test.ts`
- Create: `src/sw.ts`
- Create: `scripts/make-icons.mjs`
- Modify: `vite.config.ts` (add VitePWA plugin), `src/main.tsx` (storage persistence)
- Generated (committed): `public/icons/icon-192.png`, `icon-512.png`, `icon-maskable-512.png`

**Interfaces:**
- Consumes: `SharePayload` (Task 2).
- Produces: `storePendingShare(payload, cacheStorage?)`, `readPendingShare(cacheStorage?)`, `clearPendingShare(cacheStorage?)`, constants `SHARE_CACHE`, `PENDING_SHARE_KEY`; a built `dist/sw.js` and `dist/manifest.webmanifest` with the `share_target`; icon files.

- [ ] **Step 1: Write the failing share-payload tests**

`src/lib/sharePayload.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { clearPendingShare, readPendingShare, storePendingShare, type CacheStorageLike } from "./sharePayload";

class FakeCache {
  store = new Map<string, Response>();
  async match(key: string) {
    return this.store.get(key);
  }
  async put(key: string, response: Response) {
    this.store.set(key, response);
  }
  async delete(key: string) {
    return this.store.delete(key);
  }
}

const fakeCacheStorage = () => {
  const caches = new Map<string, FakeCache>();
  const storage: CacheStorageLike = {
    async open(name: string) {
      let cache = caches.get(name);
      if (!cache) {
        cache = new FakeCache();
        caches.set(name, cache);
      }
      return cache;
    },
  };
  return storage;
};

describe("sharePayload", () => {
  it("stores, reads, and clears a pending share", async () => {
    const storage = fakeCacheStorage();
    const payload = { title: "T", text: "cuerpo", url: "https://e.com/a", receivedAt: 123 };
    await storePendingShare(payload, storage);
    await expect(readPendingShare(storage)).resolves.toEqual(payload);
    await clearPendingShare(storage);
    await expect(readPendingShare(storage)).resolves.toBeNull();
  });

  it("returns null for garbage payloads", async () => {
    const storage = fakeCacheStorage();
    const cache = await storage.open("quiosco-share");
    await cache.put("/__pending-share", new Response("not json"));
    await expect(readPendingShare(storage)).resolves.toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/lib/sharePayload.test.ts`
Expected: FAIL — `./sharePayload` not found.

- [ ] **Step 3: Implement `src/lib/sharePayload.ts`**

```ts
import type { SharePayload } from "./types";

export const SHARE_CACHE = "quiosco-share";
export const PENDING_SHARE_KEY = "/__pending-share";

interface CacheLike {
  match(key: string): Promise<Response | undefined>;
  put(key: string, response: Response): Promise<void>;
  delete(key: string): Promise<boolean>;
}

export interface CacheStorageLike {
  open(name: string): Promise<CacheLike>;
}

function defaultCacheStorage(): CacheStorageLike {
  return caches as unknown as CacheStorageLike;
}

export async function storePendingShare(
  payload: SharePayload,
  cacheStorage: CacheStorageLike = defaultCacheStorage(),
): Promise<void> {
  const cache = await cacheStorage.open(SHARE_CACHE);
  await cache.put(
    PENDING_SHARE_KEY,
    new Response(JSON.stringify(payload), { headers: { "content-type": "application/json" } }),
  );
}

export async function readPendingShare(
  cacheStorage: CacheStorageLike = defaultCacheStorage(),
): Promise<SharePayload | null> {
  const cache = await cacheStorage.open(SHARE_CACHE);
  const response = await cache.match(PENDING_SHARE_KEY);
  if (!response) return null;
  try {
    const data = (await response.json()) as Partial<SharePayload>;
    return {
      title: typeof data.title === "string" ? data.title : "",
      text: typeof data.text === "string" ? data.text : "",
      url: typeof data.url === "string" ? data.url : "",
      receivedAt: typeof data.receivedAt === "number" ? data.receivedAt : 0,
    };
  } catch {
    return null;
  }
}

export async function clearPendingShare(
  cacheStorage: CacheStorageLike = defaultCacheStorage(),
): Promise<void> {
  const cache = await cacheStorage.open(SHARE_CACHE);
  await cache.delete(PENDING_SHARE_KEY);
}
```

Note: Cache API keys are relative strings; the browser resolves them consistently in both the page and the service worker (same origin).

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/lib/sharePayload.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the service worker**

`src/sw.ts`:

```ts
/// <reference lib="webworker" />
import { clientsClaim } from "workbox-core";
import { createHandlerBoundToURL, precacheAndRoute } from "workbox-precaching";
import { NavigationRoute, Route, registerRoute } from "workbox-routing";
import { storePendingShare } from "./lib/sharePayload";

declare let self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};

self.skipWaiting();
clientsClaim();
precacheAndRoute(self.__WB_MANIFEST);

const shareRoute = new Route(
  ({ request, url }) => request.method === "POST" && url.pathname === "/share",
  async ({ request }) => {
    const formData = await request.formData();
    await storePendingShare({
      title: String(formData.get("title") ?? ""),
      text: String(formData.get("text") ?? ""),
      url: String(formData.get("url") ?? ""),
      receivedAt: Date.now(),
    });
    return Response.redirect(new URL("/share", self.location.origin).toString(), 303);
  },
);

registerRoute(shareRoute);
registerRoute(new NavigationRoute(createHandlerBoundToURL("index.html"), { denylist: [/^\/api\//] }));
```

- [ ] **Step 6: Wire the PWA plugin and storage persistence**

Replace `vite.config.ts` with:

```ts
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      injectRegister: "auto",
      registerType: "autoUpdate",
      manifest: {
        name: "Quiosco",
        short_name: "Quiosco",
        start_url: "/",
        scope: "/",
        display: "standalone",
        background_color: "#ffffff",
        theme_color: "#0f172a",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
        share_target: {
          action: "/share",
          method: "POST",
          enctype: "multipart/form-data",
          params: { title: "title", text: "text", url: "url" },
        },
      },
      injectManifest: {
        globPatterns: ["**/*.{js,css,html,png}"],
      },
    }),
  ],
  server: { proxy: { "/api": "http://127.0.0.1:8787" } },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "worker/**/*.test.ts", "tests/**/*.test.ts"],
  },
});
```

In `src/main.tsx`, add before `createRoot(...)`:

```tsx
if (navigator.storage?.persist) {
  void navigator.storage.persist();
}
```

- [ ] **Step 7: Write and run the icon generator**

`scripts/make-icons.mjs`:

```js
import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), data])), 8 + data.length);
  return out;
}

function png(width, height, pixel) {
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, a] = pixel(x, y);
      const i = y * stride + 1 + x * 4;
      raw[i] = r;
      raw[i + 1] = g;
      raw[i + 2] = b;
      raw[i + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const BG = [15, 23, 42, 255];
const PAPER = [241, 245, 249, 255];
const INK = [37, 99, 235, 255];

function drawIcon(size, padding) {
  const inner = size - padding * 2;
  const x0 = padding + inner * 0.18;
  const y0 = padding + inner * 0.12;
  const x1 = padding + inner * 0.82;
  const y1 = padding + inner * 0.88;
  const lineHeight = inner * 0.06;
  const lines = [0.22, 0.38, 0.54, 0.7];
  return png(size, size, (x, y) => {
    if (x < x0 || x > x1 || y < y0 || y > y1) return BG;
    for (let i = 0; i < lines.length; i += 1) {
      const ly0 = y0 + (y1 - y0) * lines[i];
      const ly1 = ly0 + lineHeight;
      const lx0 = x0 + (x1 - x0) * 0.15;
      const lx1 = x0 + (x1 - x0) * (i === lines.length - 1 ? 0.55 : 0.85);
      if (y >= ly0 && y <= ly1 && x >= lx0 && x <= lx1) return INK;
    }
    return PAPER;
  });
}

mkdirSync("public/icons", { recursive: true });
writeFileSync("public/icons/icon-192.png", drawIcon(192, 16));
writeFileSync("public/icons/icon-512.png", drawIcon(512, 48));
writeFileSync("public/icons/icon-maskable-512.png", drawIcon(512, 96));
console.log("icons written: public/icons/icon-192.png icon-512.png icon-maskable-512.png");
```

Run: `pnpm icons && file public/icons/*.png`
Expected: PNG image data, 192x192 / 512x512 / 512x512.

- [ ] **Step 8: Build and verify the PWA artifacts**

```bash
pnpm typecheck && pnpm build
grep -o '"share_target":[^}]*}[^}]*}' dist/manifest.webmanifest
ls dist/sw.js dist/manifest.webmanifest
```

Expected: `share_target` present with `"action":"/share"`, `"method":"POST"`; `dist/sw.js` exists.

- [ ] **Step 9: Commit**

```bash
git add src/lib/sharePayload.ts src/lib/sharePayload.test.ts src/sw.ts scripts/make-icons.mjs public/icons vite.config.ts src/main.tsx
git commit -m "feat(pwa): share payload handoff, service worker, manifest, icons"
```

---

### Task 10: Worker foundation (env, security headers, auth)

**Files:**
- Create: `worker/env.ts`, `worker/headers.ts`, `worker/auth.ts`
- Create: `worker/headers.test.ts`, `worker/auth.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `Env`, `KVNamespaceLike`, `AssetsLike`; `CSP` string, `applySecurityHeaders(response, { noStore? })`, `jsonResponse(data, status?)`; `extractBearer(request)`, `tokensMatch(provided, expected)`, `originAllowed(request)`.

- [ ] **Step 1: Write `worker/env.ts`**

```ts
export interface KVNamespaceLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

export interface AssetsLike {
  fetch(request: Request): Promise<Response>;
}

export interface Env {
  OPENCODE_API_KEY: string;
  APP_TOKEN: string;
  JINA_API_KEY?: string;
  BUDGET: KVNamespaceLike;
  ASSETS: AssetsLike;
  ALLOWED_MODELS: string;
  DAILY_CHUNK_BUDGET: string;
}
```

(`KVNamespaceLike` is a structural subset of the real Workers KV binding; no `@cloudflare/workers-types` dependency.)

- [ ] **Step 2: Write the failing tests**

`worker/headers.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { CSP, applySecurityHeaders, jsonResponse } from "./headers";

describe("applySecurityHeaders", () => {
  it("adds the security header set", () => {
    const response = applySecurityHeaders(new Response("hi"));
    expect(response.headers.get("Content-Security-Policy")).toBe(CSP);
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(response.headers.get("X-Frame-Options")).toBe("DENY");
    expect(response.headers.get("Strict-Transport-Security")).toContain("max-age=");
    expect(response.headers.get("Permissions-Policy")).toContain("camera=()");
    expect(response.headers.get("Cache-Control")).toBeNull();
  });

  it("sets no-store when asked and preserves the status", async () => {
    const response = applySecurityHeaders(jsonResponse({ error: "x" }, 404), { noStore: true });
    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ error: "x" });
  });

  it("never emits CORS headers", () => {
    const response = applySecurityHeaders(new Response("hi"));
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});
```

`worker/auth.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { extractBearer, originAllowed, tokensMatch } from "./auth";

describe("extractBearer", () => {
  it("parses a bearer token", () => {
    const request = new Request("https://app.example/api/health", {
      headers: { Authorization: "Bearer abc123" },
    });
    expect(extractBearer(request)).toBe("abc123");
  });

  it("returns null for missing or malformed headers", () => {
    expect(extractBearer(new Request("https://app.example/api/health"))).toBeNull();
    expect(
      extractBearer(new Request("https://app.example/api/health", { headers: { Authorization: "Basic x" } })),
    ).toBeNull();
    expect(
      extractBearer(new Request("https://app.example/api/health", { headers: { Authorization: "Bearer " } })),
    ).toBeNull();
  });
});

describe("tokensMatch", () => {
  it("accepts the exact token and rejects everything else", async () => {
    await expect(tokensMatch("secret", "secret")).resolves.toBe(true);
    await expect(tokensMatch("secret", "other")).resolves.toBe(false);
    await expect(tokensMatch("secret", "")).resolves.toBe(false);
  });
});

describe("originAllowed", () => {
  const request = (origin?: string) =>
    new Request("https://app.example/api/health", origin ? { headers: { Origin: origin } } : undefined);

  it("allows missing or same-origin headers", () => {
    expect(originAllowed(request())).toBe(true);
    expect(originAllowed(request("https://app.example"))).toBe(true);
  });

  it("rejects cross-origin origins", () => {
    expect(originAllowed(request("https://evil.example"))).toBe(false);
    expect(originAllowed(request("null"))).toBe(false);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm vitest run worker/headers.test.ts worker/auth.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 4: Implement `worker/headers.ts`**

```ts
export const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'";

const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy": CSP,
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

export function applySecurityHeaders(response: Response, options: { noStore?: boolean } = {}): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value);
  if (options.noStore) headers.set("Cache-Control", "no-store");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
```

- [ ] **Step 5: Implement `worker/auth.ts`**

```ts
export function extractBearer(request: Request): string | null {
  const header = request.headers.get("Authorization") ?? "";
  if (!header.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

export async function tokensMatch(provided: string, expected: string): Promise<boolean> {
  if (expected.length === 0) return false;
  const encoder = new TextEncoder();
  const [providedDigest, expectedDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(provided)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const subtle = crypto.subtle as SubtleCrypto & {
    timingSafeEqual?: (a: ArrayBuffer, b: ArrayBuffer) => boolean;
  };
  if (typeof subtle.timingSafeEqual === "function") {
    return subtle.timingSafeEqual(providedDigest, expectedDigest);
  }
  const left = new Uint8Array(providedDigest);
  const right = new Uint8Array(expectedDigest);
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

export function originAllowed(request: Request): boolean {
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  return origin === new URL(request.url).origin;
}
```

(Digesting both sides before comparison keeps the fallback constant-time on equal-length digests; the Workers runtime path uses `crypto.subtle.timingSafeEqual`.)

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm vitest run worker/headers.test.ts worker/auth.test.ts`
Expected: PASS. Then `pnpm typecheck && pnpm lint`.

- [ ] **Step 7: Commit**

```bash
git add worker/env.ts worker/headers.ts worker/headers.test.ts worker/auth.ts worker/auth.test.ts
git commit -m "feat(worker): env types, security headers, bearer auth"
```

---

### Task 11: Worker: SSRF validator + `direct`/`googlebot` rungs

**Files:**
- Create: `worker/ssrf.ts`, `worker/ssrf.test.ts`
- Create: `worker/fetchRung.ts`, `worker/fetchRung.test.ts`

**Interfaces:**
- Consumes: `Env` (Task 10), `jsonResponse` (Task 10).
- Produces: `validateTargetUrl(raw): { ok: true; url: URL } | { ok: false; reason: string }`; `handleFetchRung(request, env, fetchImpl?): Promise<Response>`; `runRung(mode, target, env, fetchImpl?): Promise<RungOutcome>`; `fetchWithRedirects(start, headers, fetchImpl, maxRedirects?)`; `readBodyWithCap(response, maxBytes?)`; constants `FETCH_TIMEOUT_MS`, `MAX_REDIRECTS`, `MAX_RESPONSE_BYTES`, `BROWSER_UA`, `GOOGLEBOT_UA`; `RungError`, `RungOutcome`.

- [ ] **Step 1: Write the failing SSRF tests**

`worker/ssrf.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { validateTargetUrl } from "./ssrf";

describe("validateTargetUrl", () => {
  it("accepts normal public http(s) URLs", () => {
    const result = validateTargetUrl("https://elpais.com/a.html?x=1");
    expect(result.ok).toBe(true);
  });

  it("rejects non-http(s) schemes", () => {
    expect(validateTargetUrl("ftp://example.com")).toMatchObject({ ok: false, reason: "scheme" });
    expect(validateTargetUrl("javascript:alert(1)")).toMatchObject({ ok: false, reason: "scheme" });
  });

  it("rejects embedded credentials", () => {
    expect(validateTargetUrl("https://user:pass@example.com/")).toMatchObject({
      ok: false,
      reason: "credentials",
    });
  });

  it("rejects non-standard ports", () => {
    expect(validateTargetUrl("https://example.com:8443/")).toMatchObject({ ok: false, reason: "port" });
    expect(validateTargetUrl("http://example.com:80/")).toMatchObject({ ok: true });
    expect(validateTargetUrl("https://example.com:443/")).toMatchObject({ ok: true });
  });

  it("rejects every IP-literal host, including canonicalized spellings", () => {
    expect(validateTargetUrl("http://127.0.0.1/")).toMatchObject({ ok: false, reason: "ip-literal" });
    expect(validateTargetUrl("http://2130706433/")).toMatchObject({ ok: false, reason: "ip-literal" });
    expect(validateTargetUrl("http://[::ffff:169.254.169.254]/")).toMatchObject({
      ok: false,
      reason: "ip-literal",
    });
    expect(validateTargetUrl("http://[::1]/")).toMatchObject({ ok: false, reason: "ip-literal" });
    expect(validateTargetUrl("http://100.100.100.200/")).toMatchObject({ ok: false, reason: "ip-literal" });
  });

  it("rejects blocked hostnames", () => {
    expect(validateTargetUrl("http://localhost/")).toMatchObject({ ok: false, reason: "blocked-host" });
    expect(validateTargetUrl("http://foo.local/")).toMatchObject({ ok: false, reason: "blocked-host" });
    expect(validateTargetUrl("http://metadata.google.internal/")).toMatchObject({
      ok: false,
      reason: "blocked-host",
    });
  });

  it("rejects invalid URLs", () => {
    expect(validateTargetUrl("not a url")).toMatchObject({ ok: false, reason: "invalid-url" });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run worker/ssrf.test.ts`
Expected: FAIL — `./ssrf` not found.

- [ ] **Step 3: Implement `worker/ssrf.ts`**

```ts
const BLOCKED_HOSTS = new Set(["localhost", "metadata.google.internal"]);
const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/;
const IPV6_BRACKET_RE = /^\[[0-9a-f:.]+\]$/i;

export type UrlCheck = { ok: true; url: URL } | { ok: false; reason: string };

export function validateTargetUrl(raw: string): UrlCheck {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "invalid-url" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { ok: false, reason: "scheme" };
  if (url.username || url.password) return { ok: false, reason: "credentials" };
  if (url.port && url.port !== "80" && url.port !== "443") return { ok: false, reason: "port" };

  const host = url.hostname.toLowerCase();
  if (BLOCKED_HOSTS.has(host)) return { ok: false, reason: "blocked-host" };
  if (host.endsWith(".local")) return { ok: false, reason: "blocked-host" };

  // All IP-literal hosts are rejected outright. WHATWG URL canonicalizes the
  // hex/decimal/octal spellings first, so this covers http://2130706433/ and
  // IPv4-mapped IPv6 such as http://[::ffff:169.254.169.254]/.
  if (IPV4_RE.test(host) || IPV6_BRACKET_RE.test(host)) return { ok: false, reason: "ip-literal" };

  return { ok: true, url };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run worker/ssrf.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing fetchRung tests**

`worker/fetchRung.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import type { Env } from "./env";
import { GOOGLEBOT_UA, handleFetchRung, readBodyWithCap, runRung } from "./fetchRung";

const env = {} as Env; // direct/googlebot rungs do not need env

const request = (mode: string, url: string) =>
  new Request(`https://app.example/api/fetch?mode=${mode}&url=${encodeURIComponent(url)}`);

const htmlResponse = (body: string) =>
  new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });

describe("runRung", () => {
  it("fetches with the browser UA for direct", async () => {
    const fetchImpl = vi.fn(async () => htmlResponse("<html>hola</html>"));
    const outcome = await runRung("direct", "https://example.com/a", env, fetchImpl as unknown as typeof fetch);
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)["User-Agent"]).toContain("Chrome/");
    expect(new TextDecoder().decode(outcome.bytes)).toContain("hola");
    expect(outcome.kind).toBe("html");
  });

  it("uses the Googlebot UA for googlebot", async () => {
    const fetchImpl = vi.fn(async () => htmlResponse("ok"));
    await runRung("googlebot", "https://example.com/a", env, fetchImpl as unknown as typeof fetch);
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)["User-Agent"]).toBe(GOOGLEBOT_UA);
  });

  it("rejects invalid targets before fetching", async () => {
    const fetchImpl = vi.fn();
    await expect(
      runRung("direct", "ftp://example.com", env, fetchImpl as unknown as typeof fetch),
    ).rejects.toThrow("invalid target");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("follows redirects and reports the final URL", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { Location: "https://example.com/next" } }),
      )
      .mockResolvedValueOnce(htmlResponse("final"));
    const outcome = await runRung("direct", "https://example.com/a", env, fetchImpl as unknown as typeof fetch);
    expect(outcome.finalUrl).toBe("https://example.com/next");
  });

  it("rejects redirects into private addresses", async () => {
    const fetchImpl = vi.fn(
      async () => new Response(null, { status: 302, headers: { Location: "http://127.0.0.1/secret" } }),
    );
    await expect(
      runRung("direct", "https://example.com/a", env, fetchImpl as unknown as typeof fetch),
    ).rejects.toThrow("invalid hop");
  });

  it("fails after too many redirects", async () => {
    const fetchImpl = vi.fn(
      async () => new Response(null, { status: 302, headers: { Location: "https://example.com/loop" } }),
    );
    await expect(
      runRung("direct", "https://example.com/a", env, fetchImpl as unknown as typeof fetch),
    ).rejects.toThrow("too many redirects");
  });
});

describe("handleFetchRung", () => {
  it("returns bytes with via/kind/final-url headers", async () => {
    const fetchImpl = vi.fn(async () => htmlResponse("<html>ok</html>"));
    const response = await handleFetchRung(
      request("direct", "https://example.com/a"),
      env,
      fetchImpl as unknown as typeof fetch,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("x-quiosco-via")).toBe("direct");
    expect(response.headers.get("x-quiosco-kind")).toBe("html");
    expect(response.headers.get("x-quiosco-final-url")).toBe("https://example.com/a");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("maps upstream 403 to a 502 rung failure", async () => {
    const fetchImpl = vi.fn(async () => new Response("blocked", { status: 403 }));
    const response = await handleFetchRung(
      request("direct", "https://example.com/a"),
      env,
      fetchImpl as unknown as typeof fetch,
    );
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({ error: "rung failed", mode: "direct" });
  });

  it("replies 502 for unknown modes", async () => {
    const fetchImpl = vi.fn();
    const response = await handleFetchRung(
      request("bogus", "https://example.com/a"),
      env,
      fetchImpl as unknown as typeof fetch,
    );
    expect(response.status).toBe(502);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("readBodyWithCap", () => {
  it("throws when the body exceeds the cap", async () => {
    await expect(readBodyWithCap(new Response("x".repeat(2048)), 1024)).rejects.toThrow("too large");
  });

  it("returns the full body under the cap", async () => {
    const bytes = await readBodyWithCap(new Response("hola"), 1024);
    expect(new TextDecoder().decode(bytes)).toBe("hola");
  });
});
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `pnpm vitest run worker/fetchRung.test.ts`
Expected: FAIL — `./fetchRung` not found.

- [ ] **Step 7: Implement `worker/fetchRung.ts` (direct + googlebot)**

```ts
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
  bytes: Uint8Array;
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
  void env;
  const checked = validateTargetUrl(target);
  if (!checked.ok) throw new RungError(`invalid target: ${checked.reason}`);
  const url = checked.url;

  switch (mode) {
    case "direct":
      return fetchHtml(
        url,
        {
          "User-Agent": BROWSER_UA,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
        },
        fetchImpl,
      );
    case "googlebot":
      return fetchHtml(url, { "User-Agent": GOOGLEBOT_UA, "Accept-Language": "es-ES,es;q=0.9" }, fetchImpl);
    default:
      throw new RungError(`unknown mode: ${mode}`);
  }
}

async function fetchHtml(
  url: URL,
  headers: Record<string, string>,
  fetchImpl: typeof fetch,
): Promise<RungOutcome> {
  const { response, finalUrl } = await fetchWithRedirects(url, headers, fetchImpl);
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new RungError(`upstream status ${response.status}`);
  }
  const bytes = await readBodyWithCap(response);
  return { bytes, contentType: sanitizeContentType(response.headers.get("content-type")), kind: "html", finalUrl };
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
): Promise<Uint8Array> {
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
  const type = allowed.find((candidate) => lowered.startsWith(candidate)) ?? "text/html";
  const charset = /charset=([\w-]+)/.exec(lowered)?.[1];
  return charset ? `${type}; charset=${charset}` : type;
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `pnpm vitest run worker/fetchRung.test.ts`
Expected: PASS. Then `pnpm test` (full suite) and `pnpm typecheck && pnpm lint`.

- [ ] **Step 9: Commit**

```bash
git add worker/ssrf.ts worker/ssrf.test.ts worker/fetchRung.ts worker/fetchRung.test.ts
git commit -m "feat(worker): ssrf validator + direct/googlebot fetch rungs"
```

---

### Task 12: Worker: `jina`, `wayback`, `archive_ph` rungs

**Files:**
- Modify: `worker/fetchRung.ts` (add the three rung cases; remove the `void env;` line from Task 11)
- Create: `worker/fetchRung.rungs.test.ts`

**Interfaces:**
- Consumes: everything from Task 11 (`fetchWithRedirects`, `readBodyWithCap`, `RungError`, `RungOutcome`, `BROWSER_UA`), `Env.JINA_API_KEY`.
- Produces: `runRung` now handles all five modes. Jina responses are `kind: "markdown"`, content type `text/plain; charset=utf-8`.

- [ ] **Step 1: Write the failing tests**

`worker/fetchRung.rungs.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import type { Env } from "./env";
import { runRung } from "./fetchRung";

const makeEnv = (overrides: Partial<Env> = {}): Env =>
  ({ JINA_API_KEY: undefined, ...overrides }) as Env;

const htmlResponse = (body: string) =>
  new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });

describe("jina rung", () => {
  it("fetches through r.jina.ai and reports markdown", async () => {
    const fetchImpl = vi.fn(async () => new Response("Markdown Content: hola"));
    const outcome = await runRung(
      "jina",
      "https://example.com/a?b=1",
      makeEnv(),
      fetchImpl as unknown as typeof fetch,
    );
    const [calledUrl] = fetchImpl.mock.calls[0] as unknown as [string];
    expect(calledUrl).toBe("https://r.jina.ai/https://example.com/a?b=1");
    expect(outcome.kind).toBe("markdown");
    expect(new TextDecoder().decode(outcome.bytes)).toContain("hola");
  });

  it("sends the Jina key when configured", async () => {
    const fetchImpl = vi.fn(async () => new Response("ok"));
    await runRung("jina", "https://example.com/a", makeEnv({ JINA_API_KEY: "jina-secret" }), fetchImpl as unknown as typeof fetch);
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer jina-secret");
  });

  it("rejects invalid targets before any fetch", async () => {
    const fetchImpl = vi.fn();
    await expect(runRung("jina", "http://127.0.0.1/", makeEnv(), fetchImpl as unknown as typeof fetch)).rejects.toThrow(
      "invalid target",
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("wayback rung", () => {
  it("resolves the availability API and fetches the id_ snapshot", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            archived_snapshots: {
              closest: {
                available: true,
                url: "http://web.archive.org/web/20260101000000/https://example.com/a",
              },
            },
          }),
          { headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(htmlResponse("<html>snapshot</html>"));
    const outcome = await runRung("wayback", "https://example.com/a", makeEnv(), fetchImpl as unknown as typeof fetch);
    const [snapshotUrl] = fetchImpl.mock.calls[1] as unknown as [string];
    expect(snapshotUrl).toBe("https://web.archive.org/web/20260101000000id_/https://example.com/a");
    expect(new TextDecoder().decode(outcome.bytes)).toContain("snapshot");
  });

  it("fails when there is no snapshot", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ archived_snapshots: {} }), { headers: { "content-type": "application/json" } }));
    await expect(runRung("wayback", "https://example.com/a", makeEnv(), fetchImpl as unknown as typeof fetch)).rejects.toThrow(
      "no wayback snapshot",
    );
  });
});

describe("archive_ph rung", () => {
  it("follows the /newest redirect to a snapshot", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { Location: "https://archive.ph/AbC123" } }))
      .mockResolvedValueOnce(htmlResponse("<html>archived</html>"));
    const outcome = await runRung("archive_ph", "https://example.com/a", makeEnv(), fetchImpl as unknown as typeof fetch);
    expect(outcome.finalUrl).toBe("https://archive.ph/AbC123");
    expect(new TextDecoder().decode(outcome.bytes)).toContain("archived");
  });

  it("fails when /newest does not redirect", async () => {
    const fetchImpl = vi.fn(async () => htmlResponse("no results"));
    await expect(runRung("archive_ph", "https://example.com/a", makeEnv(), fetchImpl as unknown as typeof fetch)).rejects.toThrow(
      "no archive snapshot",
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run worker/fetchRung.rungs.test.ts`
Expected: FAIL — `unknown mode: jina` (and wayback/archive_ph).

- [ ] **Step 3: Extend `worker/fetchRung.ts`**

Remove the `void env;` line from `runRung`, then add these cases to the switch (and nowhere else):

```ts
    case "jina": {
      const target = url.toString().split("#")[0] ?? url.toString();
      const jinaUrl = new URL(`https://r.jina.ai/${target}`);
      const headers: Record<string, string> = { Accept: "text/plain" };
      if (env.JINA_API_KEY) headers.Authorization = `Bearer ${env.JINA_API_KEY}`;
      const { response, finalUrl } = await fetchWithRedirects(jinaUrl, headers, fetchImpl);
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw new RungError(`upstream status ${response.status}`);
      }
      const bytes = await readBodyWithCap(response);
      return { bytes, contentType: "text/plain; charset=utf-8", kind: "markdown", finalUrl };
    }
    case "wayback": {
      const availability = await fetchImpl(
        `https://archive.org/wayback/available?url=${encodeURIComponent(url.toString())}`,
        { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) },
      );
      if (!availability.ok) throw new RungError(`wayback availability ${availability.status}`);
      const data = (await availability.json()) as {
        archived_snapshots?: { closest?: { available?: boolean; url?: string } };
      };
      const snapshot = data.archived_snapshots?.closest;
      if (!snapshot?.available || !snapshot.url) throw new RungError("no wayback snapshot");
      const snapshotUrl = snapshot.url.replace(/^http:/, "https://").replace(/\/web\/(\d+)\//, "/web/$1id_/");
      const { response, finalUrl } = await fetchWithRedirects(new URL(snapshotUrl), { "User-Agent": BROWSER_UA }, fetchImpl);
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw new RungError(`upstream status ${response.status}`);
      }
      const bytes = await readBodyWithCap(response);
      return { bytes, contentType: sanitizeContentType(response.headers.get("content-type")), kind: "html", finalUrl };
    }
    case "archive_ph": {
      const newest = new URL(`https://archive.ph/newest/${url.toString()}`);
      const { response, finalUrl } = await fetchWithRedirects(newest, { "User-Agent": BROWSER_UA }, fetchImpl);
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw new RungError(`upstream status ${response.status}`);
      }
      if (!finalUrl || finalUrl.includes("/newest/")) {
        await response.body?.cancel().catch(() => undefined);
        throw new RungError("no archive snapshot");
      }
      const bytes = await readBodyWithCap(response);
      return { bytes, contentType: sanitizeContentType(response.headers.get("content-type")), kind: "html", finalUrl };
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run worker/fetchRung.rungs.test.ts worker/fetchRung.test.ts`
Expected: PASS. Then `pnpm typecheck && pnpm lint`.

- [ ] **Step 5: Commit**

```bash
git add worker/fetchRung.ts worker/fetchRung.rungs.test.ts
git commit -m "feat(worker): jina, wayback, and archive.ph fetch rungs"
```

---

### Task 13: Worker: translate proxy + KV budget

**Files:**
- Create: `worker/budget.ts`, `worker/budget.test.ts`
- Create: `worker/translate.ts`, `worker/translate.test.ts`

**Interfaces:**
- Consumes: `Env`, `KVNamespaceLike` (Task 10), `jsonResponse` (Task 10).
- Produces: `consumeChunks(kv, count, limit, now?): Promise<{ ok; used; limit }>`, `budgetKey(date)`, `DEFAULT_DAILY_CHUNK_BUDGET`; `handleTranslate(request, env, fetchImpl?): Promise<Response>`; `allowedModels(env): string[]`, `parseDailyBudget(env): number`; constants `TRANSLATE_TIMEOUT_MS`, `MAX_TRANSLATE_BODY_BYTES`.

- [ ] **Step 1: Write the failing budget tests**

`worker/budget.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { budgetKey, consumeChunks } from "./budget";

const fakeKv = () => {
  const map = new Map<string, string>();
  return {
    map,
    async get(key: string) {
      return map.get(key) ?? null;
    },
    async put(key: string, value: string) {
      map.set(key, value);
    },
  };
};

describe("budget", () => {
  it("counts chunks under the limit", async () => {
    const kv = fakeKv();
    await expect(consumeChunks(kv, 1, 10)).resolves.toEqual({ ok: true, used: 1, limit: 10 });
    await expect(consumeChunks(kv, 2, 10)).resolves.toEqual({ ok: true, used: 3, limit: 10 });
  });

  it("blocks when the limit would be exceeded, without incrementing", async () => {
    const kv = fakeKv();
    await consumeChunks(kv, 9, 10);
    await expect(consumeChunks(kv, 2, 10)).resolves.toEqual({ ok: false, used: 9, limit: 10 });
    await expect(kv.get(budgetKey(new Date()))).resolves.toBe("9");
  });

  it("uses one key per UTC day", async () => {
    const kv = fakeKv();
    await consumeChunks(kv, 1, 10, new Date("2026-09-30T23:00:00Z"));
    await consumeChunks(kv, 1, 10, new Date("2026-10-01T01:00:00Z"));
    expect(kv.map.size).toBe(2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run worker/budget.test.ts`
Expected: FAIL — `./budget` not found.

- [ ] **Step 3: Implement `worker/budget.ts`**

```ts
import type { KVNamespaceLike } from "./env";

export const DEFAULT_DAILY_CHUNK_BUDGET = 200;
const BUDGET_TTL_SECONDS = 172_800;

export interface BudgetResult {
  ok: boolean;
  used: number;
  limit: number;
}

export function budgetKey(date: Date): string {
  return `budget:${date.toISOString().slice(0, 10)}`;
}

export async function consumeChunks(
  kv: KVNamespaceLike,
  count: number,
  limit: number,
  now: Date = new Date(),
): Promise<BudgetResult> {
  const key = budgetKey(now);
  const used = Number.parseInt((await kv.get(key)) ?? "0", 10) || 0;
  if (used + count > limit) return { ok: false, used, limit };
  const next = used + count;
  await kv.put(key, String(next), { expirationTtl: BUDGET_TTL_SECONDS });
  return { ok: true, used: next, limit };
}
```

- [ ] **Step 4: Write the failing translate tests**

`worker/translate.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import type { Env } from "./env";
import { handleTranslate } from "./translate";

const fakeKv = () => {
  const map = new Map<string, string>();
  return {
    map,
    async get(key: string) {
      return map.get(key) ?? null;
    },
    async put(key: string, value: string) {
      map.set(key, value);
    },
  };
};

const makeEnv = (overrides: Partial<Env> = {}): Env => ({
  OPENCODE_API_KEY: "zen-secret",
  APP_TOKEN: "app-secret",
  BUDGET: fakeKv(),
  ASSETS: { fetch: async () => new Response("shell") },
  ALLOWED_MODELS: "deepseek-v4.1-flash,big-pickle",
  DAILY_CHUNK_BUDGET: "200",
  ...overrides,
});

const post = (body: unknown) =>
  new Request("https://app.example/api/translate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const upstreamOk = (content: string) =>
  new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    headers: { "content-type": "application/json" },
  });

describe("handleTranslate", () => {
  it("translates via the Zen API with the server-side key", async () => {
    const fetchImpl = vi.fn(async () => upstreamOk("hola"));
    const response = await handleTranslate(
      post({ model: "deepseek-v4.1-flash", system: "s", text: "t" }),
      makeEnv(),
      fetchImpl as unknown as typeof fetch,
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ text: "hola" });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://opencode.ai/zen/v1/chat/completions");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer zen-secret");
    const payload = JSON.parse(String(init.body)) as { model: string; messages: unknown[] };
    expect(payload.model).toBe("deepseek-v4.1-flash");
    expect(payload.messages).toHaveLength(2);
  });

  it("rejects models outside the allowlist", async () => {
    const fetchImpl = vi.fn();
    const response = await handleTranslate(
      post({ model: "claude-fable-5", system: "s", text: "t" }),
      makeEnv(),
      fetchImpl as unknown as typeof fetch,
    );
    expect(response.status).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects malformed requests", async () => {
    const fetchImpl = vi.fn();
    const response = await handleTranslate(
      post({ model: "deepseek-v4.1-flash" }),
      makeEnv(),
      fetchImpl as unknown as typeof fetch,
    );
    expect(response.status).toBe(400);
  });

  it("enforces the daily chunk budget with a 429", async () => {
    const env = makeEnv();
    await env.BUDGET.put(`budget:${new Date().toISOString().slice(0, 10)}`, "200");
    const fetchImpl = vi.fn();
    const response = await handleTranslate(
      post({ model: "deepseek-v4.1-flash", system: "s", text: "t" }),
      env,
      fetchImpl as unknown as typeof fetch,
    );
    expect(response.status).toBe(429);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns a generic 502 without echoing upstream bodies or keys", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response("boom-secret upstream says no", {
          status: 500,
        }),
    );
    const response = await handleTranslate(
      post({ model: "deepseek-v4.1-flash", system: "s", text: "t" }),
      makeEnv(),
      fetchImpl as unknown as typeof fetch,
    );
    expect(response.status).toBe(502);
    const body = await response.text();
    expect(body).toContain("upstream error");
    expect(body).not.toContain("boom-secret");
    expect(body).not.toContain("zen-secret");
  });

  it("rejects oversized bodies with 413", async () => {
    const fetchImpl = vi.fn();
    const response = await handleTranslate(
      post({ model: "deepseek-v4.1-flash", system: "s", text: "x".repeat(2 * 1024 * 1024 + 1) }),
      makeEnv(),
      fetchImpl as unknown as typeof fetch,
    );
    expect(response.status).toBe(413);
  });
});
```

- [ ] **Step 5: Run tests to verify they fail**

Run: `pnpm vitest run worker/translate.test.ts`
Expected: FAIL — `./translate` not found.

- [ ] **Step 6: Implement `worker/translate.ts`**

```ts
import { DEFAULT_DAILY_CHUNK_BUDGET, consumeChunks } from "./budget";
import type { Env } from "./env";
import { jsonResponse } from "./headers";

export const TRANSLATE_TIMEOUT_MS = 120_000;
export const MAX_TRANSLATE_BODY_BYTES = 2 * 1024 * 1024;
const MAX_CHUNK_TEXT_CHARS = 100_000;

export interface TranslatePayload {
  model: string;
  system: string;
  text: string;
}

export function allowedModels(env: Env): string[] {
  return (env.ALLOWED_MODELS ?? "")
    .split(",")
    .map((model) => model.trim())
    .filter((model) => model.length > 0);
}

export function parseDailyBudget(env: Env): number {
  const parsed = Number.parseInt(env.DAILY_CHUNK_BUDGET ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_DAILY_CHUNK_BUDGET;
}

export async function handleTranslate(
  request: Request,
  env: Env,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  let payload: TranslatePayload;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_TRANSLATE_BODY_BYTES) {
      return jsonResponse({ error: "request too large" }, 413);
    }
    const data = JSON.parse(raw) as Partial<TranslatePayload>;
    if (typeof data.model !== "string" || typeof data.system !== "string" || typeof data.text !== "string") {
      return jsonResponse({ error: "invalid request" }, 400);
    }
    payload = { model: data.model, system: data.system, text: data.text };
  } catch {
    return jsonResponse({ error: "invalid request" }, 400);
  }

  if (!allowedModels(env).includes(payload.model)) {
    return jsonResponse({ error: "model not allowed" }, 400);
  }
  if (payload.system.length === 0 || payload.text.trim().length === 0 || payload.text.length > MAX_CHUNK_TEXT_CHARS) {
    return jsonResponse({ error: "invalid text" }, 400);
  }

  const budget = await consumeChunks(env.BUDGET, 1, parseDailyBudget(env));
  if (!budget.ok) return jsonResponse({ error: "daily budget exceeded" }, 429);

  try {
    const upstream = await fetchImpl("https://opencode.ai/zen/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.OPENCODE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: payload.model,
        messages: [
          { role: "system", content: payload.system },
          { role: "user", content: payload.text },
        ],
      }),
      signal: AbortSignal.timeout(TRANSLATE_TIMEOUT_MS),
    });
    if (!upstream.ok) {
      await upstream.body?.cancel().catch(() => undefined);
      return jsonResponse({ error: "upstream error" }, 502);
    }
    const data = (await upstream.json()) as { choices?: Array<{ message?: { content?: unknown } }> };
    const text = data.choices?.[0]?.message?.content;
    if (typeof text !== "string") return jsonResponse({ error: "upstream error" }, 502);
    return jsonResponse({ text });
  } catch {
    return jsonResponse({ error: "upstream error" }, 502);
  }
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `pnpm vitest run worker/budget.test.ts worker/translate.test.ts`
Expected: PASS. Then full suite + `pnpm typecheck && pnpm lint`.

- [ ] **Step 8: Commit**

```bash
git add worker/budget.ts worker/budget.test.ts worker/translate.ts worker/translate.test.ts
git commit -m "feat(worker): zen translate proxy with model allowlist and daily budget"
```

---

### Task 14: Worker router: routing, health, `/share` redirect, asset passthrough

**Files:**
- Modify: `worker/index.ts` (replace the Task 1 placeholder)
- Create: `worker/index.test.ts`

**Interfaces:**
- Consumes: `Env`, `applySecurityHeaders`/`jsonResponse` (Task 10), `extractBearer`/`tokensMatch`/`originAllowed` (Task 10), `handleFetchRung` (Tasks 11-12), `handleTranslate` (Task 13).
- Produces: default export `{ fetch(request, env) }`; `handleRequest(request, env): Promise<Response>`.

- [ ] **Step 1: Write the failing router tests**

`worker/index.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import type { Env } from "./env";
import { handleRequest } from "./index";

const fakeKv = () => {
  const map = new Map<string, string>();
  return {
    map,
    async get(key: string) {
      return map.get(key) ?? null;
    },
    async put(key: string, value: string) {
      map.set(key, value);
    },
  };
};

const makeEnv = (): Env => ({
  OPENCODE_API_KEY: "zen-secret",
  APP_TOKEN: "app-secret",
  BUDGET: fakeKv(),
  ASSETS: { fetch: async () => new Response("shell", { headers: { "content-type": "text/html" } }) },
  ALLOWED_MODELS: "deepseek-v4.1-flash",
  DAILY_CHUNK_BUDGET: "200",
});

const authed = (path: string, init: RequestInit = {}) =>
  new Request(`https://app.example${path}`, {
    ...init,
    headers: { Authorization: "Bearer app-secret", ...(init.headers ?? {}) },
  });

describe("router", () => {
  it("rejects missing and wrong tokens with a uniform 401 plus security headers", async () => {
    for (const request of [
      new Request("https://app.example/api/health"),
      new Request("https://app.example/api/health", { headers: { Authorization: "Bearer nope" } }),
    ]) {
      const response = await handleRequest(request, makeEnv());
      expect(response.status).toBe(401);
      expect(response.headers.get("Content-Security-Policy")).toBeTruthy();
      expect(response.headers.get("Cache-Control")).toBe("no-store");
    }
  });

  it("rejects cross-origin Origin headers on /api/*", async () => {
    const response = await handleRequest(
      authed("/api/health", { headers: { Origin: "https://evil.example" } }),
      makeEnv(),
    );
    expect(response.status).toBe(403);
  });

  it("answers health checks for authorized same-origin requests", async () => {
    const response = await handleRequest(authed("/api/health"), makeEnv());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it("returns 404 for unknown api routes with a valid token", async () => {
    const response = await handleRequest(authed("/api/nope"), makeEnv());
    expect(response.status).toBe(404);
  });

  it("rejects wrong methods on api routes", async () => {
    const response = await handleRequest(authed("/api/health", { method: "POST" }), makeEnv());
    expect(response.status).toBe(404);
  });

  it("redirects a first-run share POST without reading the body or touching assets", async () => {
    const env = makeEnv();
    const assetsFetch = vi.spyOn(env.ASSETS, "fetch");
    const response = await handleRequest(new Request("https://app.example/share", { method: "POST" }), env);
    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe("https://app.example/share");
    expect(assetsFetch).not.toHaveBeenCalled();
  });

  it("serves assets with security headers for app routes", async () => {
    const response = await handleRequest(new Request("https://app.example/"), makeEnv());
    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("shell");
    expect(response.headers.get("Content-Security-Policy")).toBeTruthy();
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run worker/index.test.ts`
Expected: FAIL — the placeholder returns 501.

- [ ] **Step 3: Replace `worker/index.ts`**

```ts
import { extractBearer, originAllowed, tokensMatch } from "./auth";
import type { Env } from "./env";
import { handleFetchRung } from "./fetchRung";
import { applySecurityHeaders, jsonResponse } from "./headers";
import { handleTranslate } from "./translate";

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env);
  },
};

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  if (request.method === "POST" && url.pathname === "/share") {
    // The share POST normally lands in the service worker, which stores the
    // payload locally and redirects. This path only triggers before the
    // service worker is active (first run): never read or store the body.
    return applySecurityHeaders(Response.redirect(new URL("/share", url.origin).toString(), 303));
  }

  if (url.pathname.startsWith("/api/")) {
    return handleApi(request, env, url);
  }

  return applySecurityHeaders(await env.ASSETS.fetch(request));
}

async function handleApi(request: Request, env: Env, url: URL): Promise<Response> {
  const token = extractBearer(request);
  const authorized = token !== null && (await tokensMatch(token, env.APP_TOKEN));
  if (!authorized) {
    return applySecurityHeaders(jsonResponse({ error: "unauthorized" }, 401), { noStore: true });
  }
  if (!originAllowed(request)) {
    return applySecurityHeaders(jsonResponse({ error: "forbidden" }, 403), { noStore: true });
  }

  let response: Response;
  if (url.pathname === "/api/health" && request.method === "GET") {
    response = jsonResponse({ ok: true });
  } else if (url.pathname === "/api/fetch" && request.method === "GET") {
    response = await handleFetchRung(request, env);
  } else if (url.pathname === "/api/translate" && request.method === "POST") {
    response = await handleTranslate(request, env);
  } else {
    response = jsonResponse({ error: "not found" }, 404);
  }
  return applySecurityHeaders(response, { noStore: true });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run worker/index.test.ts`
Expected: PASS. Then the full suite `pnpm test` and `pnpm typecheck && pnpm lint`.

- [ ] **Step 5: Commit**

```bash
git add worker/index.ts worker/index.test.ts
git commit -m "feat(worker): router with auth, security headers, asset passthrough"
```

---

### Task 15: Smoke script + frozen URL list

**Files:**
- Create: `scripts/smoke-urls.json`
- Create: `scripts/smoke.ts`
- Create: `.dev.vars.example`

**Interfaces:**
- Consumes: `climbLadder` (Task 8), `createApi` (Task 7), the running Worker.
- Produces: `pnpm smoke` runner that prints a per-URL table and exits non-zero below a 90% pass rate.

- [ ] **Step 1: Write the frozen URL list (seed)**

`scripts/smoke-urls.json` (spec Appendix A; expand to ~18 in Step 2):

```json
[
  { "site": "elpais", "url": "https://elpais.com/economia/vivienda/2026-09-30/el-casero-tendra-que-indemnizar-con-12-mensualidades-al-inquilino-si-decide-no-renovar-el-alquiler.html" },
  { "site": "elmundo", "url": "https://www.elmundo.es/economia/vivienda/2026/09/30/6abcb33ffc6c8332128b458b.html" },
  { "site": "abc", "url": "https://www.abc.es/espana/acampada-sol-puede-desalojar-dicen-leyes-competencias-20260930132656-nt.html" },
  { "site": "lavanguardia", "url": "https://www.lavanguardia.com/politica/20260930/11647337/inquilinos-podran-suspender-desahucios-pagan-rentas-adeudan.html" },
  { "site": "elconfidencial", "url": "https://www.elconfidencial.com/espana/2026-09-30/boe-decreto-ley-vivienda-desahucios-2030-limita-subida-rentas_4435025/" },
  { "site": "expansion", "url": "https://www.expansion.com/economia/2026/09/30/6abcb23a468aebbb0e8b4589.html" },
  { "site": "elperiodico", "url": "https://www.elperiodico.com/es/economia/20260930/consultorio-nuevo-decreto-vivienda-134829941" },
  { "site": "lavozgalicia", "url": "https://www.lavozdegalicia.es/noticia/economia/2026/09/30/administraciones-tendran-compensar-propietario-particular-frene-desahucio/00031790748788699519149.htm" },
  { "site": "elespanol", "url": "https://www.elespanol.com/espana/politica/20260930/sanchez-incluye-omnibus-vivienda-guinos-sumar-junts-queda-horas-manos-podemos/1003744402136_0.html" },
  { "site": "cincodias", "url": "https://cincodias.elpais.com/mercados-financieros/2026-09-30/como-aprovechar-las-ventajas-fiscales-de-la-nueva-cuenta-de-inversion-que-ha-aprobado-el-gobierno.html" }
]
```

- [ ] **Step 2: Expand to ~18 URLs**

Add one current article each from the remaining top Spanish papers (free ones included), using `ax` to grab links:

```bash
ax https://www.marca.com/ 'a[href*="/2026"]' --row 'href=@href' --limit 5
ax https://as.com/ 'a[href*="/2026"]' --row 'href=@href' --limit 5
ax https://www.eldiario.es/ 'a[href*="2026"]' --row 'href=@href' --limit 5
ax https://www.20minutos.es/ 'a[href*="/noticia/"]' --row 'href=@href' --limit 5
ax https://www.publico.es/ 'a[href*="2026"]' --row 'href=@href' --limit 5
ax https://www.larazon.es/ 'a[href*="2026"]' --row 'href=@href' --limit 5
```

Pick one article per paper and append entries to `scripts/smoke-urls.json`. Prefer long-form pieces. This list is frozen and reviewed; when a URL rots, replace it in a dedicated commit.

- [ ] **Step 3: Write the smoke runner**

`scripts/smoke.ts`:

```ts
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { createApi } from "../src/lib/api";
import { LadderError, climbLadder } from "../src/lib/ladder";

const dom = new JSDOM();
(globalThis as { DOMParser?: unknown }).DOMParser = dom.window.DOMParser;

interface SmokeTarget {
  site: string;
  url: string;
}

const baseUrl = process.env.QUIOSCO_URL ?? "http://127.0.0.1:8787";
const token = process.env.QUIOSCO_APP_TOKEN;
if (!token) {
  console.error("QUIOSCO_APP_TOKEN is required (it is never printed)");
  process.exit(2);
}

const targets = JSON.parse(
  readFileSync(new URL("./smoke-urls.json", import.meta.url), "utf8"),
) as SmokeTarget[];

const api = createApi({
  token,
  fetchFn: ((input: RequestInfo | URL, init?: RequestInit) =>
    fetch(new URL(String(input), baseUrl), init)) as typeof fetch,
});

let passed = 0;
const rows: string[] = [];
for (const target of targets) {
  try {
    const result = await climbLadder(target.url, (rung, url) => api.fetchRung(rung, url));
    passed += 1;
    rows.push(`PASS  ${target.site.padEnd(16)} via=${result.via.padEnd(10)} chars=${result.article.text.length}`);
  } catch (error) {
    const detail =
      error instanceof LadderError
        ? error.attempts.map((attempt) => `${attempt.rung}:${attempt.reason ?? "?"}`).join(" ")
        : String(error);
    rows.push(`FAIL  ${target.site.padEnd(16)} ${detail}`);
  }
}

console.log(rows.join("\n"));
const rate = passed / targets.length;
console.log(`\n${passed}/${targets.length} passed (${Math.round(rate * 100)}%)`);
if (rate < 0.9) {
  console.error("Smoke failed: pass rate below 90%");
  process.exit(1);
}
```

`vite-node` runs this with TS and the jsdom global set before any extraction call.

- [ ] **Step 4: Local secrets + local run**

Create `.dev.vars` (gitignored) for local development, and commit `.dev.vars.example`:

```
# Copy to .dev.vars (gitignored) and fill in real values for local development.
APP_TOKEN=dev-token
OPENCODE_API_KEY=your-zen-key-here
```

Run `pnpm dev:api` in one terminal, then:

```bash
QUIOSCO_URL=http://127.0.0.1:8787 QUIOSCO_APP_TOKEN=dev-token pnpm smoke
```

Expected: a PASS/FAIL table; pass rate >= 90%. Investigate FAIL rows: if a rung is broken, fix the rung code; if a URL rotted, replace the URL entry. Do not lower the threshold.

- [ ] **Step 5: Commit**

```bash
git add scripts/smoke-urls.json scripts/smoke.ts .dev.vars.example
git commit -m "test(smoke): frozen spanish-press URL list + ladder smoke runner"
```

---

### Task 16: UI: shell, list, add/review, settings, share flow, article page

**Files:**
- Create: `src/lib/useStore.ts`, `src/lib/translateArticle.ts`, `src/lib/article.ts`
- Create: `src/routes/ListPage.tsx`, `src/routes/AddPage.tsx`, `src/routes/SettingsPage.tsx`, `src/routes/SharePage.tsx`, `src/routes/ArticlePage.tsx`
- Modify: `src/App.tsx` (router), `src/styles.css` (full styles)

**Interfaces:**
- Consumes: every lib module from Tasks 2-9.
- Produces: working screens at `/`, `/share`, `/add`, `/article/:id`, `/settings`; `translateArticle(store, article, settings): Promise<void>`; `newArticle(input): Article` and `MAX_ARTICLE_CHARS` in `src/lib/article.ts`.

- [ ] **Step 1: Shared hooks and translation glue**

`src/lib/useStore.ts`:

```ts
import { useEffect, useState } from "react";
import { createStore, type ArticleStore } from "./store";

let storePromise: Promise<ArticleStore> | null = null;

export function getStore(): Promise<ArticleStore> {
  storePromise ??= createStore();
  return storePromise;
}

export function useStore(): ArticleStore | null {
  const [store, setStore] = useState<ArticleStore | null>(null);
  useEffect(() => {
    let cancelled = false;
    void getStore().then((value) => {
      if (!cancelled) setStore(value);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return store;
}
```

`src/lib/translateArticle.ts`:

```ts
import { createApi } from "./api";
import type { ArticleStore } from "./store";
import { runTranslation } from "./translator";
import type { Article, Settings } from "./types";

export async function translateArticle(
  store: ArticleStore,
  article: Article,
  settings: Settings,
): Promise<void> {
  const api = createApi({ token: settings.appToken });
  try {
    await store.update(article.id, { translationStatus: "running", error: null });
    const { translation, totalChunks } = await runTranslation({
      text: article.text,
      settings: { targetLanguage: settings.targetLanguage, rules: settings.rules, model: settings.model },
      translate: (request) => api.translate(request),
      existingTranslation: article.translation ?? undefined,
      translatedChunks: article.translatedChunks,
      onProgress: async (progress) => {
        await store.update(article.id, {
          translation: progress.translation,
          translatedChunks: progress.translatedChunks,
          totalChunks: progress.totalChunks,
        });
      },
    });
    await store.update(article.id, { translation, translationStatus: "done", error: null, totalChunks });
  } catch (error) {
    await store.update(article.id, {
      translationStatus: "error",
      error: error instanceof Error ? error.message : "translation failed",
    });
  }
}
```

`src/lib/article.ts`:

```ts
import type { Article, Via } from "./types";

export const MAX_ARTICLE_CHARS = 150_000;

export function newArticle(input: { url: string | null; title: string; text: string; via: Via }): Article {
  const now = Date.now();
  let site: string | null = null;
  if (input.url) {
    try {
      site = new URL(input.url).hostname;
    } catch {
      site = null;
    }
  }
  return {
    id: crypto.randomUUID(),
    url: input.url,
    title: input.title.trim() || "Untitled",
    site,
    text: input.text.slice(0, MAX_ARTICLE_CHARS),
    via: input.via,
    translation: null,
    translationStatus: "pending",
    translatedChunks: 0,
    totalChunks: 0,
    status: "unread",
    error: null,
    createdAt: now,
    updatedAt: now,
  };
}
```

- [ ] **Step 2: Router shell**

`src/App.tsx`:

```tsx
import { BrowserRouter, Link, NavLink, Route, Routes } from "react-router-dom";
import AddPage from "./routes/AddPage";
import ArticlePage from "./routes/ArticlePage";
import ListPage from "./routes/ListPage";
import SettingsPage from "./routes/SettingsPage";
import SharePage from "./routes/SharePage";

export default function App() {
  return (
    <BrowserRouter>
      <header className="app-header">
        <Link to="/" className="app-title">
          Quiosco
        </Link>
        <NavLink to="/settings" className="app-nav">
          Settings
        </NavLink>
      </header>
      <main className="app">
        <Routes>
          <Route path="/" element={<ListPage />} />
          <Route path="/share" element={<SharePage />} />
          <Route path="/add" element={<AddPage />} />
          <Route path="/article/:id" element={<ArticlePage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </main>
    </BrowserRouter>
  );
}
```

- [ ] **Step 3: ListPage and SettingsPage**

`src/routes/ListPage.tsx`:

```tsx
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { Article } from "../lib/types";
import { useStore } from "../lib/useStore";

type Tab = "unread" | "read" | "archived";
const TABS: Tab[] = ["unread", "read", "archived"];

export default function ListPage() {
  const store = useStore();
  const [articles, setArticles] = useState<Article[]>([]);
  const [tab, setTab] = useState<Tab>("unread");

  useEffect(() => {
    if (!store) return;
    let cancelled = false;
    void store.list().then((all) => {
      if (!cancelled) setArticles(all);
    });
    return () => {
      cancelled = true;
    };
  }, [store]);

  if (!store) return <p className="muted">Loading…</p>;

  const counts = {
    unread: articles.filter((article) => article.status === "unread").length,
    read: articles.filter((article) => article.status === "read").length,
    archived: articles.filter((article) => article.status === "archived").length,
  };
  const visible = articles.filter((article) => article.status === tab);

  return (
    <section>
      <nav className="tabs" aria-label="Filters">
        {TABS.map((name) => (
          <button
            key={name}
            type="button"
            className={name === tab ? "tab active" : "tab"}
            onClick={() => setTab(name)}
          >
            {name} ({counts[name]})
          </button>
        ))}
        <Link className="tab add" to="/add">
          + Add
        </Link>
      </nav>
      {visible.length === 0 ? (
        <p className="muted">Nothing here yet. Share an article to Quiosco to get started.</p>
      ) : (
        <ul className="article-list">
          {visible.map((article) => (
            <li key={article.id}>
              <Link className="article-row" to={`/article/${article.id}`}>
                <span className="article-title">{article.title}</span>
                <span className="article-meta">
                  {article.site ?? "manual"} · {new Date(article.createdAt).toLocaleDateString()}
                  {article.translationStatus === "error" ? " · translation failed" : ""}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
```

`src/routes/SettingsPage.tsx`:

```tsx
import { useState } from "react";
import { createApi } from "../lib/api";
import { loadSettings, saveSettings } from "../lib/settings";
import type { Settings } from "../lib/types";

const MODEL_SUGGESTIONS = [
  "deepseek-v4.1-flash",
  "big-pickle",
  "space-bunny-free",
  "longcat-2.5-preview-free",
  "mimo-v2.6-flash-free",
  "nemotron-3.5-lightning-free",
  "gemini-3.5-flash-lite",
];

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings>(() => loadSettings());
  const [saved, setSaved] = useState(false);
  const [health, setHealth] = useState<"idle" | "checking" | "ok" | "fail">("idle");

  function update(patch: Partial<Settings>) {
    setSettings((current) => ({ ...current, ...patch }));
    setSaved(false);
  }

  function onSave() {
    saveSettings(settings);
    setSaved(true);
  }

  async function onCheck() {
    setHealth("checking");
    try {
      await createApi({ token: settings.appToken }).health();
      setHealth("ok");
    } catch {
      setHealth("fail");
    }
  }

  return (
    <section className="settings">
      <h1>Settings</h1>
      <label>
        Target language
        <input value={settings.targetLanguage} onChange={(event) => update({ targetLanguage: event.target.value })} />
      </label>
      <label>
        Translation rules (baked into the prompt)
        <textarea rows={4} value={settings.rules} onChange={(event) => update({ rules: event.target.value })} />
      </label>
      <label>
        Model
        <input
          list="model-suggestions"
          value={settings.model}
          onChange={(event) => update({ model: event.target.value })}
        />
      </label>
      <datalist id="model-suggestions">
        {MODEL_SUGGESTIONS.map((model) => (
          <option key={model} value={model} />
        ))}
      </datalist>
      <label>
        App token
        <input
          type="password"
          value={settings.appToken}
          onChange={(event) => update({ appToken: event.target.value })}
        />
      </label>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={settings.autoTranslate}
          onChange={(event) => update({ autoTranslate: event.target.checked })}
        />
        Translate automatically after saving
      </label>
      <div className="row">
        <button type="button" className="primary" onClick={onSave}>
          {saved ? "Saved" : "Save"}
        </button>
        <button type="button" onClick={onCheck}>
          Check connection
        </button>
        {health === "ok" && <span className="muted">Connected</span>}
        {health === "fail" && <span className="error">Not connected</span>}
      </div>
      <p className="muted">
        Required setup: a dedicated OpenCode Zen key with a workspace monthly limit and auto-reload off (see the
        deployment checklist in the README). When earlier rungs fail, only the article URL is sent to jina.ai,
        web.archive.org, or archive.ph.
      </p>
    </section>
  );
}
```

- [ ] **Step 4: AddPage (manual entry + review screen)**

`src/routes/AddPage.tsx`:

```tsx
import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { MAX_ARTICLE_CHARS, newArticle } from "../lib/article";
import { loadSettings } from "../lib/settings";
import { clearPendingShare, readPendingShare } from "../lib/sharePayload";
import { translateArticle } from "../lib/translateArticle";
import { useStore } from "../lib/useStore";
import { normalizeUrl } from "../lib/url";

interface PrefillState {
  prefillText?: string;
  prefillTitle?: string;
  prefillUrl?: string;
}

export default function AddPage() {
  const store = useStore();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const editId = params.get("edit");

  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!store || loaded) return;
    let cancelled = false;
    void (async () => {
      if (editId) {
        const article = await store.get(editId);
        if (!cancelled && article) {
          setTitle(article.title);
          setUrl(article.url ?? "");
          setText(article.text);
        }
      } else {
        const state = (location.state ?? null) as PrefillState | null;
        const payload = await readPendingShare();
        if (!cancelled) {
          setTitle(state?.prefillTitle ?? payload?.title ?? "");
          setUrl(state?.prefillUrl ?? payload?.url ?? "");
          setText(state?.prefillText ?? payload?.text ?? "");
        }
      }
      if (!cancelled) setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [store, loaded, editId, location.state]);

  async function onSave() {
    if (!store) return;
    const trimmed = text.trim();
    if (trimmed.length < 40) {
      setError("Paste the article text first (at least a paragraph).");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const settings = loadSettings();
      const clipped = trimmed.slice(0, MAX_ARTICLE_CHARS);
      if (editId) {
        const existing = await store.get(editId);
        const textChanged = !existing || existing.text !== clipped;
        await store.update(editId, {
          title: title.trim() || "Untitled",
          url: normalizeUrl(url),
          text: clipped,
          // Editing the text invalidates any stored translation.
          ...(textChanged
            ? {
                translation: null,
                translationStatus: "pending" as const,
                translatedChunks: 0,
                totalChunks: 0,
                error: null,
              }
            : {}),
        });
        await clearPendingShare();
        navigate(`/article/${editId}`);
        return;
      }
      const canonical = normalizeUrl(url);
      if (canonical) {
        const existing = await store.findByUrl(canonical);
        if (existing) {
          await clearPendingShare();
          navigate(`/article/${existing.id}`);
          return;
        }
      }
      const article = newArticle({ url: canonical, title, text: clipped, via: "manual" });
      await store.put(article);
      if (settings.autoTranslate && settings.appToken) {
        // Mark the run before navigating so the article page can show progress
        // and cannot start a second concurrent translation.
        await store.update(article.id, { translationStatus: "running" });
      }
      await clearPendingShare();
      navigate(`/article/${article.id}`);
      if (settings.autoTranslate && settings.appToken) {
        void translateArticle(store, article, settings);
      }
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="add">
      <h1>{editId ? "Edit article" : "Add article"}</h1>
      <label>
        Title
        <input value={title} onChange={(event) => setTitle(event.target.value)} />
      </label>
      <label>
        Source URL (optional)
        <input value={url} onChange={(event) => setUrl(event.target.value)} inputMode="url" />
      </label>
      <label>
        Article text
        <textarea rows={12} value={text} onChange={(event) => setText(event.target.value)} />
      </label>
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button type="button" className="primary" onClick={onSave} disabled={busy}>
          {editId ? "Save" : "Save & translate"}
        </button>
        <Link className="button" to="/">
          Cancel
        </Link>
      </div>
    </section>
  );
}
```

- [ ] **Step 5: SharePage (flow + failure escape hatches)**

`src/routes/SharePage.tsx`:

```tsx
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { createApi } from "../lib/api";
import { newArticle } from "../lib/article";
import { LadderError, climbLadder } from "../lib/ladder";
import { loadSettings } from "../lib/settings";
import { classifyShare, deriveTitle } from "../lib/share";
import { clearPendingShare, readPendingShare } from "../lib/sharePayload";
import { translateArticle } from "../lib/translateArticle";
import { useStore } from "../lib/useStore";
import { normalizeUrl } from "../lib/url";

type Flow =
  | { phase: "loading" }
  | { phase: "empty" }
  | { phase: "fetching"; detail: string }
  | { phase: "error"; message: string; partialText: string | null; url: string; title: string };

export default function SharePage() {
  const store = useStore();
  const navigate = useNavigate();
  const started = useRef(false);
  const [flow, setFlow] = useState<Flow>({ phase: "loading" });

  useEffect(() => {
    if (!store || started.current) return;
    started.current = true;
    void (async () => {
      const payload = await readPendingShare();
      if (!payload) {
        setFlow({ phase: "empty" });
        return;
      }
      const classification = classifyShare(payload);
      if (classification.mode !== "url") {
        navigate("/add", { state: { fromShare: true } });
        return;
      }
      const settings = loadSettings();
      setFlow({ phase: "fetching", detail: "Fetching article…" });
      try {
        const api = createApi({ token: settings.appToken });
        const result = await climbLadder(classification.url, async (rung, url) => {
          setFlow({ phase: "fetching", detail: `Trying ${rung}…` });
          return api.fetchRung(rung, url);
        });
        const canonical = normalizeUrl(classification.url);
        const existing = canonical ? await store.findByUrl(canonical) : undefined;
        if (existing) {
          await clearPendingShare();
          navigate(`/article/${existing.id}`);
          return;
        }
        const article = newArticle({
          url: canonical,
          title: deriveTitle({
            extractedTitle: result.article.title,
            sharedTitle: classification.title,
            text: result.article.text,
            url: classification.url,
          }),
          text: result.article.text,
          via: result.via,
        });
        await store.put(article);
        if (settings.autoTranslate && settings.appToken) {
          // Mark the run before navigating so the article page can show
          // progress and cannot start a second concurrent translation.
          await store.update(article.id, { translationStatus: "running" });
        }
        await clearPendingShare();
        navigate(`/article/${article.id}`);
        if (settings.autoTranslate && settings.appToken) {
          void translateArticle(store, article, settings);
        }
      } catch (error) {
        setFlow({
          phase: "error",
          message:
            error instanceof LadderError ? "Could not extract the article text." : "Fetch failed. Check your token and try again.",
          partialText: error instanceof LadderError ? error.partialText : null,
          url: classification.url,
          title: classification.title,
        });
      }
    })();
  }, [store, navigate]);

  if (flow.phase === "loading" || flow.phase === "fetching") {
    return (
      <section className="flow">
        <h1>Adding article…</h1>
        <p className="muted">{flow.phase === "fetching" ? flow.detail : "Loading…"}</p>
      </section>
    );
  }

  if (flow.phase === "empty") {
    return (
      <section className="flow">
        <h1>Nothing received</h1>
        <p className="muted">Share an article to Quiosco again, or paste the text manually.</p>
        <div className="row">
          <Link className="button primary" to="/add">
            Paste text
          </Link>
          <Link className="button" to="/">
            Back to list
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className="flow">
      <h1>Extraction failed</h1>
      <p className="error">{flow.message}</p>
      <div className="row">
        <button type="button" className="primary" onClick={() => window.location.reload()}>
          Try again
        </button>
        <Link
          className="button"
          to="/add"
          state={{ prefillText: flow.partialText ?? "", prefillUrl: flow.url, prefillTitle: flow.title }}
        >
          Paste or edit text
        </Link>
        <a className="button" href={flow.url} target="_blank" rel="noreferrer">
          Open original
        </a>
      </div>
    </section>
  );
}
```

- [ ] **Step 6: ArticlePage**

`src/routes/ArticlePage.tsx`:

```tsx
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { loadSettings } from "../lib/settings";
import { translateArticle } from "../lib/translateArticle";
import { useStore } from "../lib/useStore";
import type { Article } from "../lib/types";

const STALE_RUN_MS = 10 * 60_000;

export default function ArticlePage() {
  const store = useStore();
  const navigate = useNavigate();
  const { id } = useParams();
  const [article, setArticle] = useState<Article | null>(null);
  const [view, setView] = useState<"original" | "translation">("translation");
  const [copied, setCopied] = useState<"none" | "translation" | "original">("none");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!store || !id) return;
    let cancelled = false;
    void (async () => {
      const loaded = await store.get(id);
      if (!loaded || cancelled) return;
      setArticle(loaded);
      if (loaded.status === "unread") {
        const updated = await store.update(id, { status: "read" });
        if (!cancelled) setArticle(updated);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [store, id]);

  const running = article?.translationStatus === "running";
  useEffect(() => {
    if (!store || !id || !(running || busy)) return;
    const timer = window.setInterval(() => {
      void (async () => {
        const fresh = await store.get(id);
        if (!fresh) return;
        // A run interrupted mid-flight (tab closed/reloaded) would otherwise
        // leave "running" forever and keep the translate button disabled.
        // store.update bumps updatedAt on every write, so a long-stale
        // timestamp means no live run (worst-case live gap is ~6 min: 3
        // attempts × 120 s timeout).
        if (fresh.translationStatus === "running" && Date.now() - fresh.updatedAt > STALE_RUN_MS) {
          const recovered = await store.update(id, {
            translationStatus: "error",
            error: "Translation was interrupted — resume to continue.",
          });
          setArticle(recovered);
          return;
        }
        setArticle(fresh);
      })();
    }, 1000);
    return () => window.clearInterval(timer);
  }, [store, id, running, busy]);

  if (!article) return <p className="muted">Loading…</p>;

  async function toggleRead() {
    if (!store || !article) return;
    setArticle(await store.update(article.id, { status: article.status === "read" ? "unread" : "read" }));
  }

  async function toggleArchive() {
    if (!store || !article) return;
    setArticle(await store.update(article.id, { status: article.status === "archived" ? "unread" : "archived" }));
  }

  async function onDelete() {
    if (!store || !article) return;
    if (!window.confirm("Delete this article?")) return;
    await store.remove(article.id);
    navigate("/");
  }

  async function onRetranslate() {
    if (!store || !article || busy) return;
    const settings = loadSettings();
    if (!settings.appToken) {
      navigate("/settings");
      return;
    }
    setBusy(true);
    try {
      const fresh = await store.update(article.id, { translationStatus: "pending", error: null });
      setArticle(fresh);
      await translateArticle(store, fresh, settings);
      const reloaded = await store.get(article.id);
      if (reloaded) setArticle(reloaded);
    } finally {
      setBusy(false);
    }
  }

  async function copy(kind: "translation" | "original") {
    if (!article) return;
    const value = kind === "translation" ? article.translation : article.text;
    if (!value) return;
    await navigator.clipboard.writeText(value);
    setCopied(kind);
    window.setTimeout(() => setCopied("none"), 1500);
  }

  const body = view === "translation" ? article.translation : article.text;

  return (
    <article className="article">
      <h1>{article.title}</h1>
      <p className="article-meta">
        {article.site ?? "manual"} · {new Date(article.createdAt).toLocaleString()} · via {article.via}
        {article.url && (
          <>
            {" · "}
            <a href={article.url} target="_blank" rel="noreferrer">
              source
            </a>
          </>
        )}
      </p>
      <div className="actions">
        <button type="button" onClick={toggleRead}>
          Mark {article.status === "read" ? "unread" : "read"}
        </button>
        <button type="button" onClick={toggleArchive}>
          {article.status === "archived" ? "Unarchive" : "Archive"}
        </button>
        <Link className="button" to={`/add?edit=${article.id}`}>
          Edit text
        </Link>
        <button type="button" onClick={onRetranslate} disabled={busy || running}>
          {busy || running
            ? "Translating…"
            : article.translationStatus === "error" || (article.translation && article.translatedChunks > 0)
              ? "Resume translation"
              : "Translate"}
        </button>
        <button type="button" className="danger" onClick={onDelete}>
          Delete
        </button>
      </div>
      {article.translationStatus === "running" && (
        <p className="muted">
          Translating… {article.translatedChunks}/{article.totalChunks || "?"}
        </p>
      )}
      {article.translationStatus === "error" && article.error && <p className="error">{article.error}</p>}
      <div className="toggle">
        <button type="button" className={view === "translation" ? "active" : ""} onClick={() => setView("translation")}>
          Translation
        </button>
        <button type="button" className={view === "original" ? "active" : ""} onClick={() => setView("original")}>
          Original
        </button>
      </div>
      <div className="actions">
        <button type="button" onClick={() => copy("translation")} disabled={!article.translation}>
          {copied === "translation" ? "Copied!" : "Copy translation"}
        </button>
        <button type="button" onClick={() => copy("original")}>
          {copied === "original" ? "Copied!" : "Copy original"}
        </button>
      </div>
      {body ? <div className="article-text">{body}</div> : <p className="muted">No translation yet.</p>}
    </article>
  );
}
```

(All body content renders through a text child — no HTML interpretation.)

- [ ] **Step 7: Styles**

Replace `src/styles.css` with:

```css
:root {
  --bg: #ffffff;
  --fg: #0f172a;
  --muted: #64748b;
  --card: #f8fafc;
  --line: #e2e8f0;
  --accent: #2563eb;
  --danger: #dc2626;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0f172a;
    --fg: #e2e8f0;
    --muted: #94a3b8;
    --card: #1e293b;
    --line: #334155;
    --accent: #60a5fa;
    --danger: #f87171;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.5 system-ui, sans-serif; }
.app { max-width: 720px; margin: 0 auto; padding: 16px; }
.app-header { display: flex; justify-content: space-between; align-items: center; max-width: 720px; margin: 0 auto; padding: 12px 16px 0; }
.app-title { font-weight: 700; color: var(--fg); text-decoration: none; font-size: 1.2rem; }
.app-nav { color: var(--accent); text-decoration: none; }
h1 { font-size: 1.35rem; }
.muted { color: var(--muted); }
.error { color: var(--danger); }
.row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.tabs { display: flex; gap: 6px; margin-bottom: 12px; flex-wrap: wrap; }
.tab, .button { padding: 8px 12px; border: 1px solid var(--line); border-radius: 8px; background: var(--card); color: var(--fg); cursor: pointer; text-decoration: none; font-size: 0.95rem; }
.tab.active, .button.active, .toggle button.active { background: var(--accent); color: #fff; border-color: var(--accent); }
.tab.add { margin-left: auto; }
button.primary { background: var(--accent); color: #fff; border-color: var(--accent); }
button.danger { color: var(--danger); }
button:disabled { opacity: 0.5; cursor: default; }
.article-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.article-row { display: flex; flex-direction: column; gap: 4px; padding: 12px; border: 1px solid var(--line); border-radius: 10px; background: var(--card); color: var(--fg); text-decoration: none; }
.article-title { font-weight: 600; }
.article-meta { color: var(--muted); font-size: 0.85rem; }
.article-meta a { color: var(--muted); }
.actions { display: flex; gap: 8px; flex-wrap: wrap; margin: 12px 0; }
.toggle { display: inline-flex; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; margin: 8px 0; }
.toggle button { padding: 8px 14px; border: 0; background: var(--card); color: var(--fg); cursor: pointer; }
.article-text { white-space: pre-wrap; overflow-wrap: anywhere; background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 14px; }
.settings label, .add label { display: block; margin: 10px 0; font-size: 0.95rem; }
.settings input:not([type="checkbox"]), .settings textarea, .add input, .add textarea { width: 100%; padding: 8px; margin-top: 4px; border: 1px solid var(--line); border-radius: 8px; background: var(--bg); color: var(--fg); font: inherit; }
.settings .checkbox { display: flex; gap: 8px; align-items: center; }
.flow { text-align: left; }
```

- [ ] **Step 8: Verify**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: all green. Then a manual dev pass:

1. `pnpm dev` (two panes: worker + vite), open `http://localhost:5173`.
2. `/settings`: set a target language and rules, save; set the app token to `dev-token`; "Check connection" shows Connected (worker must be running with `.dev.vars`).
3. `+ Add`: paste a few paragraphs of any text, "Save & translate" → article page appears; translation runs if a real Zen key is configured, otherwise an error chip appears and "Resume translation" is offered.
4. List tabs: mark read/unread, archive; counts update on navigation; copy buttons flash "Copied!".
5. `/share` with no pending share shows "Nothing received".

- [ ] **Step 9: Commit**

```bash
git add src/lib/useStore.ts src/lib/translateArticle.ts src/routes src/App.tsx src/styles.css
git commit -m "feat(ui): list, add/review, settings, share flow, article page"
```

---

### Task 17: Playwright E2E + bundle scan

**Files:**
- Create: `playwright.config.ts`, `e2e/app.spec.ts`, `scripts/scan-bundle.mjs`
- Modify: `package.json` (add `"scan": "node scripts/scan-bundle.mjs"`)

**Interfaces:**
- Consumes: the built app + worker (`pnpm build && wrangler dev`).
- Produces: `pnpm e2e` suite (deterministic, no Zen network calls) and `pnpm scan`.

Scope note: E2E covers the PWA shell, headers, share handoff, and article lifecycle. Translation runtime is covered by unit tests; live translation is exercised in the manual Android QA (Task 18).

- [ ] **Step 1: Playwright config**

`playwright.config.ts`:

```ts
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  use: { baseURL: "http://127.0.0.1:8787" },
  webServer: {
    command:
      "pnpm build && pnpm exec wrangler dev --port 8787 --var APP_TOKEN:e2e-token --var OPENCODE_API_KEY:e2e-zen --var ALLOWED_MODELS:deepseek-v4.1-flash --var DAILY_CHUNK_BUDGET:200",
    url: "http://127.0.0.1:8787/",
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
```

- [ ] **Step 2: E2E specs**

`e2e/app.spec.ts`:

```ts
import { expect, test, type Page } from "@playwright/test";

async function waitForServiceWorker(page: Page) {
  await page.goto("/");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    return true;
  });
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
}

test("html document carries CSP and nosniff", async ({ page }) => {
  const response = await page.goto("/");
  expect(response?.headers()["content-security-policy"]).toContain("default-src 'self'");
  expect(response?.headers()["x-content-type-options"]).toBe("nosniff");
});

test("api requires the bearer token", async ({ request }) => {
  expect((await request.get("/api/health")).status()).toBe(401);
  const authed = await request.get("/api/health", { headers: { Authorization: "Bearer e2e-token" } });
  expect(authed.status()).toBe(200);
});

test("share target POST handoff lands on the review screen with the shared text", async ({ page }) => {
  await waitForServiceWorker(page);
  const longText = Array.from(
    { length: 20 },
    (_, index) => `Párrafo ${index} del artículo compartido manualmente con suficiente longitud para el modo texto.`,
  ).join("\n\n");
  // The production flow is an OS-initiated POST to /share, which the service
  // worker intercepts. The app's CSP has `form-action 'none'` (global
  // constraint), so an in-page <form> submit would be blocked; a same-origin
  // fetch with a FormData body hits the identical service-worker route.
  await page.evaluate(async (text) => {
    const formData = new FormData();
    formData.set("title", "Un titular");
    formData.set("text", text);
    formData.set("url", "");
    await fetch("/share", { method: "POST", body: formData });
  }, longText);
  await page.goto("/share");
  await page.waitForURL("**/add");
  await expect(page.locator("textarea")).toHaveValue(/Párrafo 19/);
});

test("manual add, read/archive lifecycle, delete", async ({ page }) => {
  await page.goto("/settings");
  await page.getByLabel("App token").fill("e2e-token");
  await page.getByLabel("Translate automatically after saving").uncheck();
  await page.getByRole("button", { name: "Save" }).click();

  await page.goto("/add");
  await page.getByLabel("Title").fill("Prueba E2E");
  const paragraphs = Array.from(
    { length: 3 },
    (_, index) => `Párrafo ${index} con contenido de prueba suficientemente largo para pasar cualquier validación.`,
  ).join("\n\n");
  await page.getByLabel("Article text").fill(paragraphs);
  await page.getByRole("button", { name: "Save & translate" }).click();

  await page.waitForURL("**/article/**");
  await expect(page.getByRole("heading", { name: "Prueba E2E" })).toBeVisible();
  await expect(page.getByText("No translation yet.")).toBeVisible();

  await page.getByRole("button", { name: "Mark unread" }).click();
  await page.getByRole("button", { name: "Archive" }).click();
  await expect(page.getByRole("button", { name: "Unarchive" })).toBeVisible();

  await page.goto("/");
  await page.getByRole("button", { name: /^archived \(1\)$/ }).click();
  await page.getByRole("link", { name: /Prueba E2E/ }).click();
  await page.waitForURL("**/article/**");
  page.on("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Delete" }).click();
  await page.waitForURL((url) => url.pathname === "/");
});

test("settings connection check reflects the worker auth", async ({ page }) => {
  await page.goto("/settings");
  await page.getByLabel("App token").fill("wrong-token");
  await page.getByRole("button", { name: "Check connection" }).click();
  await expect(page.getByText("Not connected")).toBeVisible();
  await page.getByLabel("App token").fill("e2e-token");
  await page.getByRole("button", { name: "Check connection" }).click();
  await expect(page.getByText("Connected")).toBeVisible();
});
```

- [ ] **Step 3: Bundle scan**

`scripts/scan-bundle.mjs`:

```js
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const FORBIDDEN = ["OPENCODE_API_KEY", "APP_TOKEN"];

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* walk(path);
    else yield path;
  }
}

const offenders = [];
for (const file of walk("dist")) {
  const content = readFileSync(file, "utf8");
  for (const needle of FORBIDDEN) {
    if (content.includes(needle)) offenders.push(`${file}: ${needle}`);
  }
}
if (offenders.length > 0) {
  console.error(`Bundle scan failed — forbidden strings found:\n${offenders.join("\n")}`);
  process.exit(1);
}
console.log("Bundle scan clean (no server-only secret names in the client build)");
```

- [ ] **Step 4: Run the suite**

```bash
pnpm exec playwright install chromium
pnpm e2e
pnpm build && pnpm scan
```

Expected: all Playwright tests pass; bundle scan clean. If the share-handoff test is flaky around SW activation, fix the wait logic — do not remove the test.

- [ ] **Step 5: Commit**

```bash
git add playwright.config.ts e2e scripts/scan-bundle.mjs package.json
git commit -m "test(e2e): playwright flows + client bundle secret scan"
```

---

### Task 18: README, CI workflow, acceptance prep

**Files:**
- Create: `README.md`, `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: everything.
- Produces: deployment checklist (spec Appendix B), CI (check job on push/PR; weekly smoke job), Android QA checklist, acceptance evidence.

- [ ] **Step 1: Write `README.md`**

```markdown
# Quiosco

Personal Android-first PWA: share an article URL (or manually extracted article
text) from the Android share sheet, and Quiosco extracts the text, translates it
via OpenCode Zen with your custom prompt, and keeps it in a local
read/unread/archived list with copy-to-clipboard.

Design spec: `docs/superpowers/specs/2026-09-30-quiosco-design.md`.

## Architecture

- **PWA** (React + Vite + vite-plugin-pwa) — extraction (DOMParser +
  Readability), 5-rung fetch ladder orchestration, IndexedDB storage, UI.
- **Cloudflare Worker** — serves the built PWA and a thin authenticated proxy:
  `/api/fetch` (rung passthrough), `/api/translate` (Zen), `/api/health`.
- **Storage** — articles live only on your device. Nothing is stored
  server-side.

## Development

```bash
pnpm install
cp .dev.vars.example .dev.vars   # fill in APP_TOKEN and OPENCODE_API_KEY
pnpm dev                          # vite + wrangler dev (same-origin /api proxy)
pnpm test                         # unit tests
pnpm typecheck && pnpm lint
pnpm e2e                          # playwright (builds + runs wrangler dev)
pnpm smoke                        # against a deployed instance (see below)
```

## Deployment checklist (required)

1. **Zen**: create a dedicated API key for Quiosco; set a workspace monthly
   usage limit; disable auto-reload. Quiosco also enforces a server-side model
   allowlist and a daily translate budget as containment layers.
2. **KV**: `pnpm wrangler kv namespace create BUDGET` — paste the id into
   `wrangler.toml`.
3. **Secrets**:
   `pnpm wrangler secret put OPENCODE_API_KEY` and
   `pnpm wrangler secret put APP_TOKEN` (generate: `openssl rand -hex 32`).
4. **Deploy**: `pnpm deploy`.
5. **Verify**: `GET /` returns the CSP header; `GET /api/health` returns 401
   without the token.

Optional hardening: a Cloudflare rate-limiting rule on `/api/*`; 2FA on the
Cloudflare and OpenCode accounts.

## Install on Android

1. Open the deployed URL in **Chrome for Android** → menu → **Install app**.
2. **Open the app once** so the service worker is active; sharing before that
   lands on a "Nothing received" screen.
3. Share an article from Chrome → pick Quiosco. Share selected text the same
   way (it becomes the article text, with the URL kept as the source link when
   provided).
4. After a manifest change, reinstall from Chrome (WebAPK update lag).

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
```

- [ ] **Step 2: CI workflow**

`.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
  pull_request:
  schedule:
    - cron: "0 6 * * 1"
  workflow_dispatch:

jobs:
  check:
    if: github.event_name == 'push' || github.event_name == 'pull_request' || github.event_name == 'workflow_dispatch'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 9
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm lint
      - run: pnpm test
      - run: pnpm build
      - run: pnpm scan

  smoke:
    if: github.event_name == 'schedule' || github.event_name == 'workflow_dispatch'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 9
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm smoke
        env:
          QUIOSCO_URL: ${{ secrets.QUIOSCO_URL }}
          QUIOSCO_APP_TOKEN: ${{ secrets.QUIOSCO_APP_TOKEN }}
```

(Repo secrets `QUIOSCO_URL` and `QUIOSCO_APP_TOKEN` must be set for the weekly
smoke job.)

- [ ] **Step 3: Acceptance run**

1. Deploy to the real workers.dev URL (Step 1 checklist).
2. `QUIOSCO_URL=... QUIOSCO_APP_TOKEN=... pnpm smoke` — record the table; must
   be >= 90%, target 100% for the press list. Replace rotted URLs in a
   dedicated commit if needed.
3. Run the manual Android checklist from the README on the phone.
4. Record the outcome (date, pass rate, notes) in the commit message for the
   final commit.

- [ ] **Step 4: Commit**

```bash
git add README.md .github/workflows/ci.yml
git commit -m "docs: readme, deploy checklist, CI with weekly smoke job"
```

---

## Execution notes

- Run tasks in order; each task commits independently and leaves the tree green.
- Review checkpoints: after Task 9 (PWA artifacts), Task 14 (worker complete),
  Task 15 (ladder verified against the live press), Task 16 (UI complete), and
  Task 18 (acceptance).
- If the worker `assets.run_worker_first` option is unavailable in the
  installed wrangler version, fall back to a `public/_headers` file for the
  static-document CSP and keep the Worker setting headers on `/api/*`; note the
  deviation in the commit message.

