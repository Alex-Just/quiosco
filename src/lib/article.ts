import type { Article, Via } from "./types";

export const MAX_ARTICLE_CHARS = 150_000;
/** Minimum pasted/fetched body length before Save accepts the article. */
export const MIN_ARTICLE_TEXT_CHARS = 40;

/** Text shown in the Original view: cleaned body when cleanup has finished. */
export function originalText(article: Article): string {
  return article.cleanText || article.text;
}

export function newArticle(input: {
  url: string | null;
  title: string;
  text: string;
  via: Via;
  cleanup?: boolean;
}): Article {
  const now = Date.now();
  let site: string | null = null;
  if (input.url) {
    try {
      site = new URL(input.url).hostname;
    } catch {
      site = null;
    }
  }
  return {
    id: crypto.randomUUID(),
    url: input.url,
    title: input.title.trim() || "Untitled",
    site,
    text: input.text.slice(0, MAX_ARTICLE_CHARS),
    via: input.via,
    translation: null,
    partial: null,
    translationStatus: "pending",
    translatedChunks: 0,
    totalChunks: 0,
    cleanText: null,
    translationPhase: null,
    phaseStartedAt: null,
    cleanDurationMs: null,
    translateDurationMs: null,
    model: null,
    cleanup: input.cleanup ?? true,
    status: "unread",
    error: null,
    createdAt: now,
    updatedAt: now,
  };
}
