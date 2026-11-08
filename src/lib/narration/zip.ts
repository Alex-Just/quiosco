// Read-only zip access over a Blob, without loading the archive.
//
// A narration pack is one zip of several hundred megabytes. Browsers expose
// Blob slices lazily, so reading the central directory at the tail and then
// slicing one entry is O(1) memory: import stores the archive untouched and
// playback slices a chapter's bytes as needed.
//
// Only the subset of the format `fflate` writes is supported: no Zip64, no
// encryption, no multi-disk archives.

import { inflateSync } from "fflate";
import { NarrationError } from "./manifest";

const END_OF_DIRECTORY = 0x06054b50;
const CENTRAL_HEADER = 0x02014b50;
const LOCAL_HEADER = 0x04034b50;
const END_OF_DIRECTORY_BYTES = 22;
const CENTRAL_HEADER_BYTES = 46;
const LOCAL_HEADER_BYTES = 30;
const ZIP64_SENTINEL = 0xffffffff;
/** Trailing comment cap, so the EOCD is always inside the last 64 KiB. */
const MAX_COMMENT_BYTES = 0xffff;

export interface ZipEntry {
  name: string;
  /** 0 = stored, 8 = deflate. */
  method: number;
  /** Absolute offset of the entry's payload inside the archive. */
  offset: number;
  /** Uncompressed length in bytes. */
  size: number;
  /** Stored length in bytes; equals `size` for stored entries. */
  compressedSize: number;
}

const decoder = new TextDecoder();

const view = (bytes: Uint8Array) =>
  new DataView(bytes.buffer, bytes.byteOffset);

async function readBytes(blob: Blob, start: number, end: number) {
  return new Uint8Array(await blob.slice(start, end).arrayBuffer());
}

/** Index of the end-of-central-directory record, or -1. */
function findEndOfDirectory(bytes: Uint8Array): number {
  const data = view(bytes);
  for (let at = bytes.length - END_OF_DIRECTORY_BYTES; at >= 0; at -= 1) {
    if (data.getUint32(at, true) === END_OF_DIRECTORY) return at;
  }
  return -1;
}

/**
 * Every entry of the archive, keyed by name. Reads two small ranges (the
 * directory and each entry's local header), never the payloads.
 */
export async function readZipIndex(blob: Blob): Promise<Map<string, ZipEntry>> {
  if (blob.size === 0) throw new NarrationError("not a narration pack");

  const tailLength = Math.min(
    blob.size,
    MAX_COMMENT_BYTES + END_OF_DIRECTORY_BYTES,
  );
  const tailStart = blob.size - tailLength;
  const tail = await readBytes(blob, tailStart, blob.size);
  const at = findEndOfDirectory(tail);
  if (at < 0) throw new NarrationError("not a narration pack");

  const end = view(tail);
  const count = end.getUint16(at + 10, true);
  const directorySize = end.getUint32(at + 12, true);
  const directoryOffset = end.getUint32(at + 16, true);
  if (
    count === 0xffff ||
    directorySize === ZIP64_SENTINEL ||
    directoryOffset === ZIP64_SENTINEL
  ) {
    throw new NarrationError("narration packs over 4 GB are not supported");
  }

  const directory = await readBytes(
    blob,
    directoryOffset,
    directoryOffset + directorySize,
  );
  const header = view(directory);
  const entries = new Map<string, ZipEntry>();
  let cursor = 0;

  for (let index = 0; index < count; index += 1) {
    if (cursor + CENTRAL_HEADER_BYTES > directory.length) {
      throw new NarrationError("narration pack is truncated");
    }
    if (header.getUint32(cursor, true) !== CENTRAL_HEADER) {
      throw new NarrationError("narration pack is damaged");
    }
    const method = header.getUint16(cursor + 10, true);
    const compressedSize = header.getUint32(cursor + 20, true);
    const size = header.getUint32(cursor + 24, true);
    const nameLength = header.getUint16(cursor + 28, true);
    const extraLength = header.getUint16(cursor + 30, true);
    const commentLength = header.getUint16(cursor + 32, true);
    const localOffset = header.getUint32(cursor + 42, true);
    const name = decoder.decode(
      directory.subarray(
        cursor + CENTRAL_HEADER_BYTES,
        cursor + CENTRAL_HEADER_BYTES + nameLength,
      ),
    );

    if (localOffset === ZIP64_SENTINEL || size === ZIP64_SENTINEL) {
      throw new NarrationError("narration packs over 4 GB are not supported");
    }

    // The local header's own name/extra lengths decide where data begins;
    // they may differ from the directory copy.
    const local = view(
      await readBytes(blob, localOffset, localOffset + LOCAL_HEADER_BYTES),
    );
    if (local.getUint32(0, true) !== LOCAL_HEADER) {
      throw new NarrationError("narration pack is damaged");
    }
    const dataOffset =
      localOffset +
      LOCAL_HEADER_BYTES +
      local.getUint16(26, true) +
      local.getUint16(28, true);

    entries.set(name, {
      name,
      method,
      offset: dataOffset,
      size,
      compressedSize,
    });
    cursor += CENTRAL_HEADER_BYTES + nameLength + extraLength + commentLength;
  }

  return entries;
}

/** The entry's bytes, inflated when it was deflated. */
export async function readZipEntry(
  blob: Blob,
  entry: ZipEntry,
): Promise<Uint8Array> {
  const bytes = await readBytes(
    blob,
    entry.offset,
    entry.offset + entry.compressedSize,
  );
  if (entry.method === 0) return bytes;
  if (entry.method === 8) return inflateSync(bytes);
  throw new NarrationError(`unsupported zip method ${entry.method}`);
}
