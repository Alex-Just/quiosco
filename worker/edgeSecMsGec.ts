/**
 * Microsoft Edge Read Aloud Sec-MS-GEC v2 token (Workers-safe).
 * Ported from node-edge-tts DRM (standard SHA-256 + CS64), not the older
 * plain SHA-256 v1 token that api.msedgeservices.com now rejects.
 */

export const TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
export const CHROMIUM_FULL_VERSION = "143.0.3650.75";
export const SEC_MS_GEC_VERSION_V2 = `2-${CHROMIUM_FULL_VERSION}`;

const WINDOWS_FILE_TIME_EPOCH_SECONDS = 11_644_473_600n;
const CLOCK_ROUND_SECONDS = 300n;
const WINDOWS_TICKS_PER_SECOND = 10_000_000n;

/** Fixed Microsoft copyright prefix hashed into the v2 digest. */
const PREFIX = Uint8Array.from(
  atob(
    "Q29weXJpZ2h0IChDKSBNaWNyb3NvZnQgQ29ycG9yYXRpb24uIEFsbCByaWdodHMgcmVzZXJ2ZWQu",
  ),
  (char) => char.charCodeAt(0),
);

const COEFFICIENTS: readonly (readonly [number, number])[] = [
  [0xe82e91b1, 0xb32700d0],
  [0x44de24c6, 0x88dff51d],
  [0x3beb65bc, 0x29514038],
  [0xc89c5933, 0xb328cbdf],
  [0x8d1ec211, 0xd405b4d5],
  [0x314ef5d5, 0x26e55f3c],
  [0xe92491b1, 0x607801c6],
  [0xf0a5b9d5, 0x82b2c1fb],
  [0x06064cf3, 0xfa51a3da],
  [0xda79fa60, 0x207cc464],
  [0xbed20560, 0x3c3c74f3],
  [0x89f9c9f8, 0xd2d14b61],
  [0x35fa38c6, 0xbb04a2c1],
  [0xcb49e3c6, 0xc5626167],
];

function mul(a: number, b: number): number {
  return Math.imul(a, b) >>> 0;
}

function rol16(value: number): number {
  return ((value << 16) | (value >>> 16)) >>> 0;
}

function readU32LE(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] ?? 0) |
      ((bytes[offset + 1] ?? 0) << 8) |
      ((bytes[offset + 2] ?? 0) << 16) |
      ((bytes[offset + 3] ?? 0) << 24)) >>>
    0
  );
}

function writeU32LE(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
  bytes[offset + 2] = (value >>> 16) & 0xff;
  bytes[offset + 3] = (value >>> 24) & 0xff;
}

function toHexUpper(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

function cs64Digest(data: Uint8Array, shaDigest: Uint8Array): Uint8Array {
  const keyA = (readU32LE(shaDigest, 0) | 1) >>> 0;
  const keyB = (readU32LE(shaDigest, 4) | 1) >>> 0;
  const factors = [mul(keyA, 0x82893933), mul(keyB, 0x82893933)] as const;
  const terms = COEFFICIENTS.map(
    ([coefficient], index) => mul(coefficient, factors[index % 2] ?? 0) >>> 0,
  );
  const offsets = COEFFICIENTS.map(([, offset]) => offset);

  const paddedLength = Math.ceil((data.length + 1) / 8) * 8;
  const padded = new Uint8Array(paddedLength);
  padded.set(data, 1);
  for (let index = 0; index < padded.length / 4; index += 1) {
    const word = readU32LE(padded, index * 4);
    let term = mul(word, index % 2 === 0 ? keyA : keyB);
    let offset = mul(rol16(word), index % 2 === 0 ? 0xef0569fb : 0xc31713db);
    if (index === 0) {
      term = (term + mul(0xf2f90b1a, factors[0])) >>> 0;
      offset = (offset + 0x0b1a0000) >>> 0;
    }
    terms.push(term >>> 0);
    offsets.push(offset >>> 0);
  }

  let swapAcc = 0;
  let swapLast = 0;
  let state = 0;
  let acc = 0;
  for (let index = 0; index < terms.length; index += 2) {
    const x = terms[index] ?? 0;
    const y = terms[index + 1] ?? 0;
    const offsetX = offsets[index] ?? 0;
    const offsetY = offsets[index + 1] ?? 0;
    let t = rol16((offsetX + x) >>> 0);
    let q = mul(t, 0x76f50f34);
    swapAcc += (mul(rol16(q), 0xc3efea97) + q) >>> 0;
    t = rol16((offsetY + y) >>> 0);
    q = mul(t, 0x1881ce3c);
    swapLast = (mul(rol16(q), 0x35bd1ec9) + q) >>> 0;
    swapAcc = (swapAcc + swapLast) >>> 0;
    state = (mul(state, keyA) + x) >>> 0;
    for (const k of [0xcf98b111, 0x87085b9f, 0x12ceb96d, 0x257e1d83] as const) {
      state = mul(rol16(state), k) >>> 0;
    }
    acc += state;
    t = (mul(state, keyB) + y) >>> 0;
    t = mul(rol16(t), 0xa27416f5) >>> 0;
    t = mul(rol16(t), 0xd38396ff) >>> 0;
    state = mul(rol16(mul(rol16(t), 0x7c932b89)), 0xbfa49f69) >>> 0;
    acc = (acc + state) >>> 0;
  }

  const result = new Uint8Array(8);
  writeU32LE(result, 0, (swapLast ^ state) >>> 0);
  writeU32LE(result, 4, (swapAcc ^ acc) >>> 0);
  return result;
}

async function sha256(parts: readonly Uint8Array[]): Promise<Uint8Array> {
  let total = 0;
  for (const part of parts) total += part.length;
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.length;
  }
  const digest = await crypto.subtle.digest("SHA-256", joined);
  return new Uint8Array(digest);
}

/**
 * Build a Sec-MS-GEC v2 token for the given Unix time (seconds).
 * Format: `<16 hex CS64>-<64 hex SHA-256>`.
 */
export async function generateSecMsGecV2(
  unixSeconds: number = Date.now() / 1000,
): Promise<string> {
  if (!Number.isFinite(unixSeconds)) {
    throw new TypeError("unixSeconds must be a finite number");
  }
  const epochSeconds =
    BigInt(Math.floor(unixSeconds)) + WINDOWS_FILE_TIME_EPOCH_SECONDS;
  const roundedSeconds = epochSeconds - (epochSeconds % CLOCK_ROUND_SECONDS);
  const ticks = roundedSeconds * WINDOWS_TICKS_PER_SECOND;
  const data = new TextEncoder().encode(
    `${ticks.toString()}${TRUSTED_CLIENT_TOKEN}`,
  );
  const sha = await sha256([PREFIX, data]);
  const cs64 = cs64Digest(data, sha);
  return `${toHexUpper(cs64)}-${toHexUpper(sha)}`;
}
