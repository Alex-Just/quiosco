import type { Article } from "./types";

export type ZenEndAction = "archive" | "delete";

/**
 * Actions offered in the block at the end of a Zen article. Archive is dropped
 * once the article is archived, where the toggle would flip it back to unread.
 */
export function zenEndActions(
  article: Pick<Article, "status">,
): ZenEndAction[] {
  return article.status === "archived" ? ["delete"] : ["archive", "delete"];
}

/**
 * The end block shows on the first and last paragraph of a Zen article, so the
 * actions are reachable without swiping and again once the article is read.
 */
export function isZenEndPage(index: number, total: number): boolean {
  return total > 0 && (index === 0 || index === total - 1);
}
