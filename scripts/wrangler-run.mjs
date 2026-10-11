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
// pnpm treats bare -c as its own flag; `--` forwards -c to wrangler.
// Global flags must still precede the subcommand (deploy/dev/…).
const args = [
  "exec",
  "--",
  "wrangler",
  "-c",
  config,
  ...process.argv.slice(2),
];

const child = spawn("pnpm", args, {
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
