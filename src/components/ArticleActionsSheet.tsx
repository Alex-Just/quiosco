import { Link } from "react-router-dom";
import { translateActionLabel } from "../lib/articleDisplayHelpers";
import { formatPhaseTimings } from "../lib/format";
import type { Article, ArticleKind } from "../lib/types";

type ArticleActionsSheetProps = {
  article: Article;
  translationBody: string;
  copied: "none" | "translation" | "original";
  zenMode: boolean;
  zenAvailable: boolean;
  /** Books hide the article-only entries and add Chapters. */
  kind?: ArticleKind;
  chaptersAvailable?: boolean;
  onOpenChapters?: () => void;
  /** Zen-only translation mode; the entry renders when the handler is set. */
  translationMode?: boolean;
  onToggleTranslationMode?: () => void;
  /** Why the translation entry cannot be used (missing app token). */
  translationHint?: string | null;
  /** Books only: export the EPUB from the cache as it is now. */
  onExportEpub?: () => void;
  /** Books only: start the whole-book finish run; the export follows it. */
  onFinishExport?: () => void;
  /** Books only: shown while a finish run can be cancelled. */
  onCancelFinish?: () => void;
  finishRunning?: boolean;
  /** Why the finish entry cannot be used (missing app token). */
  finishExportHint?: string | null;
  exporting?: boolean;
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
  kind,
  chaptersAvailable,
  onOpenChapters,
  translationMode,
  onToggleTranslationMode,
  translationHint,
  onExportEpub,
  onFinishExport,
  onCancelFinish,
  finishRunning,
  finishExportHint,
  exporting,
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
  const isBook = kind === "book";

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
        aria-label={isBook ? "Book actions" : "Article actions"}
      >
        {timings && <p className="sheet-meta">{timings}</p>}
        <div className="sheet-list">
          <button type="button" onClick={() => runAndClose(onToggleRead)}>
            Mark {article.status === "read" ? "unread" : "read"}
          </button>
          <button type="button" onClick={() => runAndClose(onToggleArchive)}>
            {article.status === "archived" ? "Unarchive" : "Archive"}
          </button>
          {isBook ? (
            chaptersAvailable &&
            onOpenChapters && (
              <button type="button" onClick={() => runAndClose(onOpenChapters)}>
                Chapters
              </button>
            )
          ) : (
            <>
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
            </>
          )}
          {isBook && onToggleTranslationMode && (
            <>
              <button
                type="button"
                disabled={translationHint != null}
                onClick={() => runAndClose(onToggleTranslationMode)}
              >
                {translationMode ? "Exit translation mode" : "Translation mode"}
              </button>
              {translationHint != null && (
                <p className="sheet-hint muted">{translationHint}</p>
              )}
            </>
          )}
          {isBook && onExportEpub && (
            <button
              type="button"
              disabled={exporting}
              onClick={() => runAndClose(onExportEpub)}
            >
              Export EPUB
            </button>
          )}
          {isBook &&
            onFinishExport &&
            (finishRunning && onCancelFinish ? (
              <button type="button" onClick={() => runAndClose(onCancelFinish)}>
                Cancel whole-book translation
              </button>
            ) : (
              <>
                <button
                  type="button"
                  // translationHint disables it too: in Zen the existing hint
                  // explains both disabled entries, and the finish entry
                  // renders no second hint of its own.
                  disabled={
                    finishExportHint != null ||
                    translationHint != null ||
                    exporting
                  }
                  onClick={() => runAndClose(onFinishExport)}
                >
                  Fully translate, then export
                </button>
                {finishExportHint != null && (
                  <p className="sheet-hint muted">{finishExportHint}</p>
                )}
              </>
            ))}
          {zenAvailable && (
            <button type="button" onClick={() => runAndClose(onToggleZen)}>
              {zenMode ? "Exit Zen mode" : "Zen mode"}
            </button>
          )}
          {!isBook && (
            <button
              type="button"
              disabled={!translationBody}
              onClick={() => onCopy("translation")}
            >
              {copied === "translation" ? "Copied!" : "Copy translation"}
            </button>
          )}
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
