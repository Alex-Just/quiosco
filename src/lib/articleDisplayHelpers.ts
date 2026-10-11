import { originalText } from "./article";
import { formatDurationMs } from "./format";
import type { Article, ArticleView } from "./types";

export function joinTranslationBody(article: Article): string {
  return [article.translation, article.partial]
    .filter((value): value is string => Boolean(value))
    .join("\n\n");
}

export function articleBody(article: Article, view: ArticleView): string {
  const translationBody = joinTranslationBody(article);
  return view === "translation" ? translationBody : originalText(article);
}

export function bodyParagraphs(body: string): string[] {
  return (body ?? "")
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
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
