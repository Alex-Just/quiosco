import { originalText } from "./article";
import { formatDurationMs } from "./format";
import type { Article, ArticleView } from "./types";

export function joinTranslationBody(article: Article): string {
  return [article.translation, article.partial]
    .filter((value): value is string => Boolean(value))
    .join("\n\n");
}

/** Row attribution in lists: a book's author, or where an article came from. */
export function listSource(article: Article): string {
  if (article.kind === "book") return article.author ?? "book";
  return article.site ?? "manual";
}

export function articleBody(article: Article, view: ArticleView): string {
  const translationBody = joinTranslationBody(article);
  return view === "translation" ? translationBody : originalText(article);
}

/** Bare index line the model left alone ("1", "12.", "3)"); not a year. */
const BARE_PARAGRAPH_NUMBER = /^\d{1,3}\s*[.)º°]?$/;

export function bodyParagraphs(body: string): string[] {
  const parts = (body ?? "")
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  return coalesceBareNumberParagraphs(parts);
}

// Some models put a blank line after the paragraph index, so "1" and the
// flag/body become two blocks. Glue them so the dimmed n/total marker works.
function coalesceBareNumberParagraphs(paragraphs: string[]): string[] {
  const result: string[] = [];
  for (let index = 0; index < paragraphs.length; index += 1) {
    const current = paragraphs[index] ?? "";
    const next = paragraphs[index + 1];
    if (
      next != null &&
      BARE_PARAGRAPH_NUMBER.test(current) &&
      !BARE_PARAGRAPH_NUMBER.test(next)
    ) {
      result.push(`${current}\n${next}`);
      index += 1;
      continue;
    }
    result.push(current);
  }
  return result;
}

export function runningStatusText(article: Article, now: number): string {
  const phaseLine =
    article.translationPhase === "cleaning"
      ? article.totalChunks > 0
        ? `Cleaning up the text… ${article.translatedChunks}/${article.totalChunks}`
        : "Cleaning up the text…"
      : `Translating… ${article.translatedChunks}/${article.totalChunks || "?"}`;

  return [
    article.translationPhase === "translating" &&
    article.cleanDurationMs != null
      ? `Cleaned in ${formatDurationMs(article.cleanDurationMs)}`
      : null,
    phaseLine,
    article.phaseStartedAt != null
      ? formatDurationMs(now - article.phaseStartedAt)
      : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function translateActionLabel(article: Article): string {
  if (article.translationStatus === "done") return "Re-translate";
  if (
    article.translationStatus === "error" ||
    (article.translation && article.translatedChunks > 0)
  ) {
    return "Resume translation";
  }
  return "Translate";
}
