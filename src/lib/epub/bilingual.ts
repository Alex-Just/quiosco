// Shared contract for Quiosco's bilingual EPUB sidecar. The sidecar is a
// normal optional ZIP entry; other EPUB readers ignore it, while the importer
// uses it to seed the sentence cache with the exact source/translation pairs.
import type { BookChapter } from "../types";

export const BILINGUAL_SIDECAR_PATH = "OEBPS/quiosco-bilingual.json";
export const BILINGUAL_SIDECAR_VERSION = 1;

export interface BilingualEntry {
  source: string;
  translation: string;
}

export interface BilingualBook {
  targetLanguage: string;
  entries: BilingualEntry[];
  /** Source-only chapters, so the importer never has to guess the pairing. */
  chapters?: BookChapter[];
}

/** True for the sidecar path, case-insensitively and at any ZIP directory. */
export function isBilingualSidecarPath(path: string): boolean {
  return /(^|\/)quiosco-bilingual\.json$/i.test(path);
}

export function buildBilingualSidecar(book: BilingualBook): string {
  return JSON.stringify({
    version: BILINGUAL_SIDECAR_VERSION,
    targetLanguage: book.targetLanguage,
    entries: book.entries,
    ...(book.chapters !== undefined && book.chapters.length > 0
      ? { chapters: book.chapters }
      : {}),
  });
}

/** Parse and validate a sidecar; malformed data is ignored, not fatal. */
export function parseBilingualSidecar(raw: string): BilingualBook | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(value) || value.version !== BILINGUAL_SIDECAR_VERSION) {
    return null;
  }
  if (
    typeof value.targetLanguage !== "string" ||
    value.targetLanguage.trim().length === 0 ||
    !Array.isArray(value.entries)
  ) {
    return null;
  }

  const entries: BilingualEntry[] = [];
  for (const entry of value.entries) {
    if (!isRecord(entry)) continue;
    if (
      typeof entry.source !== "string" ||
      typeof entry.translation !== "string"
    ) {
      continue;
    }
    if (
      entry.source.trim().length === 0 ||
      entry.translation.trim().length === 0
    ) {
      continue;
    }
    entries.push({ source: entry.source, translation: entry.translation });
  }

  if (entries.length === 0) return null;

  let chapters: BookChapter[] | undefined;
  if (Array.isArray(value.chapters)) {
    const parsedChapters = value.chapters.flatMap((chapter) => {
      if (!isRecord(chapter)) return [];
      if (
        typeof chapter.title !== "string" ||
        typeof chapter.text !== "string"
      ) {
        return [];
      }
      return [{ title: chapter.title, text: chapter.text }];
    });
    if (parsedChapters.length > 0) chapters = parsedChapters;
  }

  return {
    targetLanguage: value.targetLanguage.trim(),
    entries,
    ...(chapters === undefined ? {} : { chapters }),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
