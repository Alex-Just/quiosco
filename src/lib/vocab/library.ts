import { cardsFromBook } from "./book";
import type { LookupResult } from "./card";

export interface BookIdentity {
  title: string;
  author: string;
}

export interface LookupGroup {
  identity: BookIdentity;
  lines: string[];
}

export interface OpenedBook {
  identity: BookIdentity;
  bytes: Uint8Array;
}

export function normalizeBookName(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase();
}

/** Same title. An empty author does not reject the other name. */
export function sameBook(left: BookIdentity, right: BookIdentity): boolean {
  if (normalizeBookName(left.title) !== normalizeBookName(right.title)) {
    return false;
  }
  const leftAuthor = normalizeBookName(left.author);
  const rightAuthor = normalizeBookName(right.author);
  if (!leftAuthor || !rightAuthor) return true;
  return leftAuthor === rightAuthor;
}

export function chooseBooks<T extends BookIdentity>(
  wanted: BookIdentity,
  books: readonly T[],
): T[] {
  return books.filter((book) => sameBook(wanted, book));
}

export function lookupWord(line: string): string {
  const record = parseRecord(line);
  return typeof record?.word === "string" ? record.word.trim() : "";
}

export function lookupIdentity(line: string): BookIdentity | null {
  const record = parseRecord(line);
  if (!record || typeof record.title !== "string") return null;
  const title = record.title.trim();
  if (!title) return null;
  const author = typeof record.author === "string" ? record.author.trim() : "";
  return { title, author };
}

export function groupLookups(lines: readonly string[]): {
  groups: LookupGroup[];
  skipped: string[];
} {
  const groups: LookupGroup[] = [];
  const skipped: string[] = [];
  for (const line of lines) {
    const identity = lookupIdentity(line);
    if (!identity) {
      skipped.push(line);
      continue;
    }
    const existing = groups.find((group) => sameBook(group.identity, identity));
    if (existing) existing.lines.push(line);
    else groups.push({ identity, lines: [line] });
  }
  return { groups, skipped };
}

/**
 * Picks a book by title and author, then by the saved sentence.
 * `catalog` order is the search order. Paths are not compared to the title.
 */
export async function cardsFromCatalog(
  lines: readonly string[],
  identity: BookIdentity,
  catalog: readonly { path: string }[],
  open: (path: string) => Promise<OpenedBook | null>,
): Promise<LookupResult[]> {
  const opened: (OpenedBook & { path: string })[] = [];
  const seen = new Set<string>();
  const openOnce = async (path: string) => {
    const existing = opened.find((book) => book.path === path);
    if (existing) return existing;
    if (seen.has(path)) return null;
    seen.add(path);
    const book = await open(path);
    if (!book) return null;
    const stored = { ...book, path };
    opened.push(stored);
    return stored;
  };
  const fromBytes = (bytes: Uint8Array) =>
    lines.map((line) => cardsFromBook(bytes, line));

  for (const item of catalog) {
    const book = await openOnce(item.path);
    if (!book || !sameBook(identity, book.identity)) continue;
    const results = fromBytes(book.bytes);
    if (results.some((result) => result.ok)) return results;
  }
  for (const book of opened) {
    if (sameBook(identity, book.identity)) continue;
    const results = fromBytes(book.bytes);
    if (results.some((result) => result.ok)) return results;
  }
  return lines.map((line) => ({
    ok: false as const,
    word: lookupWord(line),
    reason: "missing-book",
  }));
}

function parseRecord(line: string): Record<string, unknown> | null {
  try {
    const record = JSON.parse(line) as unknown;
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      return null;
    }
    return record as Record<string, unknown>;
  } catch {
    return null;
  }
}
