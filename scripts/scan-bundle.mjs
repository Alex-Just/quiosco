import { readdirSync, readFileSync, statSync } from "node:fs";
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
  console.error(
    `Bundle scan failed — forbidden strings found:\n${offenders.join("\n")}`,
  );
  process.exit(1);
}
console.log(
  "Bundle scan clean (no server-only secret names in the client build)",
);
