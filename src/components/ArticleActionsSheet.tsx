import { Link } from "react-router-dom";
import { translateActionLabel } from "../lib/articleDisplayHelpers";
import { formatPhaseTimings } from "../lib/format";
import type { Article } from "../lib/types";

type ArticleActionsSheetProps = {
  article: Article;
  translationBody: string;
  copied: "none" | "translation" | "original";
  zenMode: boolean;
  zenAvailable: boolean;
  onClose: () => void;
  onToggleRead: () => void;
  onToggleArchive: () => void;
  onRetranslate: () => void;
  onDelete: () => void;
  onCopy: (kind: "translation" | "original") => void;
  onToggleZen: () => void;
};

export function ArticleActionsSheet({
  article,
  translationBody,
  copied,
  zenMode,
  zenAvailable,
  onClose,
  onToggleRead,
  onToggleArchive,
  onRetranslate,
  onDelete,
  onCopy,
  onToggleZen,
}: ArticleActionsSheetProps) {
  const timings = formatPhaseTimings({
    cleanDurationMs: article.cleanDurationMs,
    translateDurationMs: article.translateDurationMs,
  });

  const runAndClose = (action: () => void) => {
    action();
    onClose();
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: backdrop tap closes; matches SentenceSheet
    <div
      className="sheet-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Article actions"
      >
        {timings && <p className="sheet-meta">{timings}</p>}
        <div className="sheet-list">
          <button type="button" onClick={() => runAndClose(onToggleRead)}>
            Mark {article.status === "read" ? "unread" : "read"}
          </button>
          <button type="button" onClick={() => runAndClose(onToggleArchive)}>
            {article.status === "archived" ? "Unarchive" : "Archive"}
          </button>
          <Link
            className="button"
            to={`/add?edit=${article.id}`}
            onClick={onClose}
          >
            Edit text
          </Link>
          <button type="button" onClick={() => runAndClose(onRetranslate)}>
            {translateActionLabel(article)}
          </button>
          {zenAvailable && (
            <button type="button" onClick={() => runAndClose(onToggleZen)}>
              {zenMode ? "Exit Zen mode" : "Zen mode"}
            </button>
          )}
          <button
            type="button"
            disabled={!translationBody}
            onClick={() => onCopy("translation")}
          >
            {copied === "translation" ? "Copied!" : "Copy translation"}
          </button>
          <button type="button" onClick={() => onCopy("original")}>
            {copied === "original" ? "Copied!" : "Copy original"}
          </button>
          <button
            type="button"
            className="danger"
            onClick={() => runAndClose(onDelete)}
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
