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
