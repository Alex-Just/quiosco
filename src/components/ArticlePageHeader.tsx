import { formatDateTime } from "../lib/format";
import type { Article } from "../lib/types";

type ArticlePageHeaderProps = {
  article: Article;
};

export function ArticlePageHeader({ article }: ArticlePageHeaderProps) {
  return (
    <>
      <h1>{article.title}</h1>
      <p className="article-meta">
        {article.site ?? "manual"} · {formatDateTime(article.createdAt)} · via{" "}
        {article.via}
        {article.model ? ` · translated with ${article.model}` : ""}
        {article.url && (
          <>
            {" · "}
            <a href={article.url} target="_blank" rel="noreferrer">
              source
            </a>
          </>
        )}
      </p>
    </>
  );
}
