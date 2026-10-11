#!/usr/bin/env node
/**
 * Prefer gitignored wrangler.local.toml (personal Cloudflare resource ids)
 * when present; otherwise use the committed template wrangler.toml.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const LOCAL_CONFIG = "wrangler.local.toml";
const TEMPLATE_CONFIG = "wrangler.toml";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const config = existsSync(path.join(root, LOCAL_CONFIG))
  ? LOCAL_CONFIG
  : TEMPLATE_CONFIG;

const [command, ...rest] = process.argv.slice(2);
if (!command) {
  console.error("usage: node scripts/wrangler-run.mjs <command> [...args]");
  process.exit(1);
}

// Subcommand first, then --config: wrangler rejects `-c` before the command.
const wranglerBin = path.join(root, "node_modules", ".bin", "wrangler");
const child = spawn(wranglerBin, [command, "--config", config, ...rest], {
  cwd: root,
  stdio: "inherit",
  shell: process.platform === "win32",
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
