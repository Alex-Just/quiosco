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
