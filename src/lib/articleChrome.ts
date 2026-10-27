import { bodyParagraphs, joinTranslationBody } from "./articleDisplayHelpers";
import type { Article } from "./types";

/**
 * Finished idle articles use a compact reading chrome: view toggle + ⋯ menu.
 * Active translation / errors keep the full action rows visible.
 */
export function articleChromeCompact(
  article: Article,
  working: boolean,
): boolean {
  return !working && article.translationStatus === "done";
}

/**
 * Zen opens once the streamed body has at least one paragraph. Most articles
 * are a single chunk, so readable text lives in `partial` until the run ends;
 * committed `translation` alone would wait for the whole article.
 */
export function articleZenAvailable(article: Article): boolean {
  return bodyParagraphs(joinTranslationBody(article)).length > 0;
}
