import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createApi } from "../src/lib/api";
import { climbLadder, LadderError } from "../src/lib/ladder";

// jsdom ships no type declarations and the repo does not carry @types/jsdom.
const nodeRequire = createRequire(import.meta.url);
const { JSDOM } = nodeRequire("jsdom") as {
  JSDOM: new () => { window: { DOMParser: typeof DOMParser } };
};

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
    const result = await climbLadder(target.url, (rung, url) =>
      api.fetchRung(rung, url),
    );
    passed += 1;
    rows.push(
      `PASS  ${target.site.padEnd(16)} via=${result.via.padEnd(10)} chars=${result.article.text.length}`,
    );
  } catch (error) {
    const detail =
      error instanceof LadderError
        ? error.attempts
            .map((attempt) => `${attempt.rung}:${attempt.reason ?? "?"}`)
            .join(" ")
        : String(error);
    rows.push(`FAIL  ${target.site.padEnd(16)} ${detail}`);
  }
}

console.log(rows.join("\n"));
const rate = passed / targets.length;
console.log(
  `\n${passed}/${targets.length} passed (${Math.round(rate * 100)}%)`,
);
if (rate < 0.9) {
  console.error("Smoke failed: pass rate below 90%");
  process.exit(1);
}
