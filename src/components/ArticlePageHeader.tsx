import { Link } from "react-router-dom";
import { translateActionLabel } from "../lib/articleDisplayHelpers";
import { formatDateTime } from "../lib/format";
import type { Article } from "../lib/types";

type ArticlePageHeaderProps = {
  article: Article;
  working: boolean;
  onToggleRead: () => void;
  onToggleArchive: () => void;
  onCancel: () => void;
  onRetranslate: () => void;
  onDelete: () => void;
};

export function ArticlePageHeader({
  article,
  working,
  onToggleRead,
  onToggleArchive,
  onCancel,
  onRetranslate,
  onDelete,
}: ArticlePageHeaderProps) {
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
      <div className="actions">
        {!working && (
          <>
            <button type="button" onClick={onToggleRead}>
              Mark {article.status === "read" ? "unread" : "read"}
            </button>
            <button type="button" onClick={onToggleArchive}>
              {article.status === "archived" ? "Unarchive" : "Archive"}
            </button>
          </>
        )}
        <Link className="button" to={`/add?edit=${article.id}`}>
          Edit text
        </Link>
        {working ? (
          <button type="button" className="danger" onClick={onCancel}>
            Cancel
          </button>
        ) : (
          <button type="button" onClick={onRetranslate}>
            {translateActionLabel(article)}
          </button>
        )}
        <button type="button" className="danger" onClick={onDelete}>
          Delete
        </button>
      </div>
    </>
  );
}
