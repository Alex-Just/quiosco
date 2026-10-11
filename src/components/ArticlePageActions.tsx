import { Link } from "react-router-dom";
import { translateActionLabel } from "../lib/articleDisplayHelpers";
import type { Article } from "../lib/types";

type ArticlePageActionsProps = {
  article: Article;
  working: boolean;
  onToggleRead: () => void;
  onToggleArchive: () => void;
  onCancel: () => void;
  onRetranslate: () => void;
  onDelete: () => void;
};

export function ArticlePageActions({
  article,
  working,
  onToggleRead,
  onToggleArchive,
  onCancel,
  onRetranslate,
  onDelete,
}: ArticlePageActionsProps) {
  return (
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
  );
}
