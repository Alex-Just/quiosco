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
  out.writeUInt32BE(
    crc32(Buffer.concat([Buffer.from(type, "ascii"), data])),
    8 + data.length,
  );
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
console.log(
  "icons written: public/icons/icon-192.png icon-512.png icon-maskable-512.png",
);
