import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  use: { baseURL: "http://127.0.0.1:8787" },
  webServer: {
    command:
      "pnpm build && pnpm exec wrangler d1 execute quiosco --local --file worker/migrations/0001_sync.sql && pnpm exec wrangler dev --port 8787 --var APP_TOKEN:e2e-token --var OPENCODE_API_KEY:e2e-zen --var ALLOWED_MODELS:deepseek-v4.1-flash --var DAILY_CHUNK_BUDGET:200",
    url: "http://127.0.0.1:8787/",
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
