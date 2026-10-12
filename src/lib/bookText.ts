import { bodyParagraphs } from "./articleDisplayHelpers";
import { splitSentences, stripSentenceMarkers } from "./sentences";
import type { Article } from "./types";

/** Cap for one translation unit; longer sentences are cut at whitespace. */
export const MAX_BOOK_UNIT_CHARS = 4_000;

export interface BookSentenceUnit {
  paragraphIndex: number;
  text: string;
  skipped: boolean;
}

const HAS_LETTER = /\p{L}/u;
// The whitespace that starts the non-whitespace tail of the capped slice; the
// last whitespace inside the cap, since everything after is non-whitespace.
const LAST_WHITESPACE = /\s\S*$/;

/** Every chapter title followed by its paragraphs, flat; body when no chapters. */
export function bookFlatParagraphs(article: Article): string[] {
  const chapters = article.chapters;
  if (!chapters?.length) return bodyParagraphs(article.text);
  return chapters.flatMap((chapter) => [
    chapter.title,
    ...bodyParagraphs(chapter.text),
  ]);
}

/** Flat-paragraph index of each chapter title, in chapter order. */
export function bookChapterStarts(article: Article): number[] {
  const chapters = article.chapters;
  if (!chapters?.length) return [];
  const starts: number[] = [];
  let index = 0;
  for (const chapter of chapters) {
    starts.push(index);
    index += 1 + bodyParagraphs(chapter.text).length;
  }
  return starts;
}

// Cut an oversized sentence at the last whitespace that fits inside the cap,
// so every returned piece is at most MAX_BOOK_UNIT_CHARS long; a sentence with
// no whitespace inside the cap is hard-cut.
function splitAtCap(text: string): string[] {
  const parts: string[] = [];
  let rest = text;
  while (rest.length > MAX_BOOK_UNIT_CHARS) {
    const cap = rest.slice(0, MAX_BOOK_UNIT_CHARS);
    const cut = cap.search(LAST_WHITESPACE);
    if (cut <= 0) {
      parts.push(cap);
      rest = rest.slice(MAX_BOOK_UNIT_CHARS);
      continue;
    }
    parts.push(cap.slice(0, cut));
    rest = rest.slice(cut + 1);
  }
  parts.push(rest);
  return parts;
}

/**
 * Sentences of every paragraph as translation units. Markers (number, flag)
 * are stripped; a letterless unit is skipped, i.e. translated never and
 * always rendered from its source text.
 */
export function bookSentenceUnits(
  paragraphs: readonly string[],
): BookSentenceUnit[] {
  const units: BookSentenceUnit[] = [];
  paragraphs.forEach((paragraph, paragraphIndex) => {
    for (const sentence of splitSentences(paragraph)) {
      const text = stripSentenceMarkers(sentence).trim();
      if (!text) continue;
      for (const part of splitAtCap(text)) {
        units.push({
          paragraphIndex,
          text: part,
          skipped: !HAS_LETTER.test(part),
        });
      }
    }
  });
  return units;
}

/** Unit indices per flat paragraph, in reading order. */
export function unitsByParagraph(
  units: readonly BookSentenceUnit[],
): Map<number, number[]> {
  const byParagraph = new Map<number, number[]>();
  units.forEach((unit, index) => {
    const indices = byParagraph.get(unit.paragraphIndex);
    if (indices) indices.push(index);
    else byParagraph.set(unit.paragraphIndex, [index]);
  });
  return byParagraph;
}

/** True when every non-skipped unit of the paragraph has a translation. */
export function paragraphComplete(
  units: readonly BookSentenceUnit[],
  unitIndices: readonly number[],
  translations: ReadonlyMap<number, string>,
): boolean {
  return unitIndices.every((index) => {
    const unit = units[index];
    return unit == null || unit.skipped || translations.has(index);
  });
}
