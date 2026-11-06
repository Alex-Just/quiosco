#!/usr/bin/env node
/**
 * Replace placeholder Cloudflare resource ids in wrangler.toml.
 * Used by CI before deploy. Requires QUIOSCO_KV_NAMESPACE_ID and
 * QUIOSCO_D1_DATABASE_ID in the environment.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const KV_PLACEHOLDER = "00000000000000000000000000000000";
const D1_PLACEHOLDER = "00000000-0000-0000-0000-000000000000";

const kvId = process.env.QUIOSCO_KV_NAMESPACE_ID;
const d1Id = process.env.QUIOSCO_D1_DATABASE_ID;
if (!kvId || !d1Id) {
  console.error(
    "QUIOSCO_KV_NAMESPACE_ID and QUIOSCO_D1_DATABASE_ID are required",
  );
  process.exit(1);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = path.join(root, "wrangler.toml");
const before = readFileSync(target, "utf8");
if (!before.includes(KV_PLACEHOLDER) || !before.includes(D1_PLACEHOLDER)) {
  console.error(
    "wrangler.toml must contain both the KV and D1 zero placeholders",
  );
  process.exit(1);
}
const after = before
  .replaceAll(KV_PLACEHOLDER, kvId)
  .replaceAll(D1_PLACEHOLDER, d1Id);
if (after.includes(KV_PLACEHOLDER) || after.includes(D1_PLACEHOLDER)) {
  console.error(
    "wrangler.toml still contains a zero placeholder after injection",
  );
  process.exit(1);
}
writeFileSync(target, after);
console.log("Injected Cloudflare resource ids into wrangler.toml");
