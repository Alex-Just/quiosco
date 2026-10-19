// Export assembly: a book plus its verified sentence cache becomes one
// complete EPUB. Reads mirror the reader's exactly — same key memo, same
// verified cache reads, same Zen display pairing — so what any device's Zen
// shows is what lands in the file, and untranslated sentences fall back to
// their source text.
import {
  type BookSentenceUnit,
  bookChapterStarts,
  bookFlatParagraphs,
  bookSentenceUnits,
  unitsByParagraph,
} from "../bookText";
import { readCachedTranslations } from "../bookTranslation";
import {
  type BookTranslationMaterial,
  createSentenceKeyMemo,
} from "../sentenceKey";
import type { ArticleStore } from "../store";
import type { Article } from "../types";
import { pairSourceWithTranslation } from "../zenTranslationDisplay";
import {
  buildEpubBytes,
  type EpubChapterInput,
  exportFilename,
} from "./buildEpub";

const DEFAULT_READ_BATCH_UNITS = 500;

/**
 * Chapter display blocks for the writer. The paragraph at each chapter start
 * is the title (never re-rendered into the body); every other paragraph
 * contributes the Zen display block of each of its units, in index order.
 * Whole-book exports with no chapters become one untitled chapter.
 */
export function assembleExportChapters(args: {
  article: Article;
  units: readonly BookSentenceUnit[];
  translations: ReadonlyMap<number, string>;
}): EpubChapterInput[] {
  const { article, units, translations } = args;
  const flat = bookFlatParagraphs(article);
  const starts = bookChapterStarts(article);
  const byParagraph = unitsByParagraph(units);

  const displayBlocks = (paragraphIndex: number): string[] =>
    (byParagraph.get(paragraphIndex) ?? []).map((unitIndex) =>
      pairSourceWithTranslation(
        units[unitIndex]?.text ?? "",
        translations.get(unitIndex) ?? "",
      ),
    );

  const ranges =
    starts.length === 0
      ? [{ title: "", from: 0, to: flat.length }]
      : starts.map((start, index) => ({
          title: flat[start] ?? "",
          from: start + 1,
          to: starts[index + 1] ?? flat.length,
        }));

  return ranges.map((range) => {
    const paragraphs: string[] = [];
    for (
      let paragraphIndex = range.from;
      paragraphIndex < range.to;
      paragraphIndex += 1
    ) {
      paragraphs.push(...displayBlocks(paragraphIndex));
    }
    return { title: range.title, paragraphs };
  });
}

/**
 * Read every sentence's verified translation (in batches, yielding to the
 * event loop between them so the UI stays responsive), then assemble the
 * EPUB. `uuid`, `now` and `readBatchUnits` are test seams.
 */
export async function exportBookEpub(args: {
  store: Pick<ArticleStore, "getSentences">;
  article: Article;
  settings: BookTranslationMaterial;
  uuid?: string;
  now?: Date;
  readBatchUnits?: number;
}): Promise<{ bytes: Uint8Array; filename: string }> {
  const { store, article, settings } = args;
  const readBatchUnits = args.readBatchUnits ?? DEFAULT_READ_BATCH_UNITS;

  const paragraphs = bookFlatParagraphs(article);
  const units = bookSentenceUnits(paragraphs);
  const keyMemo = createSentenceKeyMemo(settings);
  const keyFor = (unitIndex: number) =>
    keyMemo.keyFor(units[unitIndex]?.text ?? "");
  const rulesHashValue = await keyMemo.rulesHash();

  const translations = new Map<number, string>();
  for (let start = 0; start < units.length; start += readBatchUnits) {
    const batchTranslations = await readCachedTranslations({
      store,
      units,
      unitIndices: Array.from(
        { length: Math.min(readBatchUnits, units.length - start) },
        (_, offset) => start + offset,
      ),
      keyFor,
      targetLanguage: settings.targetLanguage,
      rulesHashValue,
    });
    for (const [unitIndex, translation] of batchTranslations) {
      translations.set(unitIndex, translation);
    }
    if (start + readBatchUnits < units.length) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  const bytes = buildEpubBytes({
    title: article.title,
    author: article.author ?? null,
    language: article.bookLanguage ?? settings.targetLanguage,
    chapters: assembleExportChapters({ article, units, translations }),
    uuid: args.uuid ?? crypto.randomUUID(),
    modified: (args.now ?? new Date()).toISOString(),
  });
  return { bytes, filename: exportFilename(article.title) };
}

/** Hand the finished EPUB to the browser as a download. */
export function downloadEpub(bytes: Uint8Array, filename: string): void {
  // slice() re-backs the copy with a plain ArrayBuffer, which BlobPart needs;
  // zipSync's view type carries the SharedArrayBuffer-capable union.
  const blob = new Blob([bytes.slice()], { type: "application/epub+zip" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
