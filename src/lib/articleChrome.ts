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
