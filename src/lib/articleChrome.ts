import type { Article } from "./types";

/** Finished articles hide the action chrome behind a disclosure by default. */
export function articleChromeCollapsible(
  article: Article,
  working: boolean,
): boolean {
  return !working && article.translationStatus === "done";
}
