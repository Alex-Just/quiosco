import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  // The suite shares one Worker and one D1. Parallel files race on the sync
  // settings row and the daily budget, so run them serially.
  workers: 1,
  use: { baseURL: "http://127.0.0.1:8787" },
  webServer: {
    // Hermetic e2e state: sync pushes rows into D1, so a persistent local
    // database would leak articles across runs and break count assertions.
    // KOSYNC_KEY is md5("secret"), matching e2e/kosync.spec.ts.
    command:
      "rm -rf .wrangler/e2e-state && pnpm build && pnpm exec wrangler d1 execute quiosco --local --persist-to .wrangler/e2e-state --file worker/migrations/0001_sync.sql && pnpm exec wrangler d1 execute quiosco --local --persist-to .wrangler/e2e-state --file worker/migrations/0002_kosync.sql && pnpm exec wrangler dev --port 8787 --persist-to .wrangler/e2e-state --var APP_TOKEN:e2e-token --var OPENCODE_API_KEY:e2e-zen --var ALLOWED_MODELS:deepseek-v4.1-flash --var DAILY_CHUNK_BUDGET:200 --var KOSYNC_USER:quiosco --var KOSYNC_KEY:5ebe2294ecd0e0f08eab7690d2a6ee69",
    url: "http://127.0.0.1:8787/",
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
