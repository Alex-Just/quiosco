export const DEFAULT_READER = "http://crosspoint.local";
export const READER_VOCAB_PATH = "/Vocabulary.txt";
export const MAX_READER_DEPTH = 8;
export const READER_SKIP_DIRECTORY_NAMES = new Set([
  "XTCache",
  "System Volume Information",
]);

export interface ReaderListingEntry {
  name: string;
  size: number;
  isDirectory: boolean;
  isEpub: boolean;
}

export interface ReaderEpubFile {
  path: string;
  size: number;
}

function readerBase(reader: string): string {
  return reader.endsWith("/") ? reader : `${reader}/`;
}

/** File Transfer serves this URL while the reader is on Wi-Fi. */
export function readerDownloadUrl(reader: string, path: string): string {
  const url = new URL("download", readerBase(reader));
  url.searchParams.set("path", path);
  return url.toString();
}

export function readerFilesUrl(reader: string, directory: string): string {
  const url = new URL("api/files", readerBase(reader));
  url.searchParams.set("path", directory);
  return url.toString();
}

export function parseReaderListing(value: unknown): ReaderListingEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const record = entry as {
      name?: unknown;
      size?: unknown;
      isDirectory?: unknown;
      isEpub?: unknown;
    };
    if (typeof record.name !== "string" || !isSafeName(record.name)) return [];
    const size =
      typeof record.size === "number" &&
      Number.isFinite(record.size) &&
      record.size >= 0
        ? record.size
        : 0;
    const isEpub =
      record.isEpub === true || record.name.toLowerCase().endsWith(".epub");
    return [
      {
        name: record.name,
        size,
        isDirectory: record.isDirectory === true && !isEpub,
        isEpub,
      },
    ];
  });
}

export function readerChildPath(directory: string, name: string): string {
  const base = directory === "/" ? "" : directory.replace(/\/$/, "");
  return `${base}/${name}`;
}

export function readerEntriesToWalk(
  directory: string,
  listing: readonly ReaderListingEntry[],
): { epubs: ReaderEpubFile[]; directories: string[] } {
  const depth = directory.split("/").filter((part) => part.length > 0).length;
  const epubs: ReaderEpubFile[] = [];
  const directories: string[] = [];
  for (const entry of listing) {
    if (entry.name.startsWith(".")) continue;
    const path = readerChildPath(directory, entry.name);
    if (entry.isEpub) {
      epubs.push({ path, size: entry.size });
      continue;
    }
    if (
      entry.isDirectory &&
      depth < MAX_READER_DEPTH &&
      !READER_SKIP_DIRECTORY_NAMES.has(entry.name)
    ) {
      directories.push(path);
    }
  }
  return { epubs, directories };
}

function isSafeName(name: string): boolean {
  return (
    name.length > 0 &&
    name !== "." &&
    name !== ".." &&
    !name.includes("/") &&
    !name.includes("\0")
  );
}
