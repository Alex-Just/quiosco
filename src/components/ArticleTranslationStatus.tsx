import { runningStatusText } from "../lib/articleDisplayHelpers";
import { formatPhaseTimings } from "../lib/format";
import type { Article } from "../lib/types";

type ArticleTranslationStatusProps = {
  article: Article;
  now: number;
};

export function ArticleTranslationStatus({
  article,
  now,
}: ArticleTranslationStatusProps) {
  const finishedTimings = formatPhaseTimings({
    cleanDurationMs: article.cleanDurationMs,
    translateDurationMs: article.translateDurationMs,
  });

  return (
    <>
      {article.translationStatus === "running" && (
        <p className="muted pulse">{runningStatusText(article, now)}</p>
      )}
      {article.translationStatus !== "running" && finishedTimings && (
        <p className="muted">{finishedTimings}</p>
      )}
      {article.translationStatus === "error" && article.error && (
        <p className="error">{article.error}</p>
      )}
    </>
  );
}
