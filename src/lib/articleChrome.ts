import { bodyParagraphs } from "./articleDisplayHelpers";
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
 * Zen opens once the first committed translation paragraph exists, so the
 * reader can start while later chunks still stream in the background.
 * Partial text from the chunk in flight does not count.
 */
export function articleZenAvailable(article: Article): boolean {
  return bodyParagraphs(article.translation ?? "").length > 0;
}
