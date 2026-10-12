import type { ArticleView } from "../lib/types";

type ArticleReadingToolbarProps = {
  view: ArticleView;
  onSwitchView: (view: ArticleView) => void;
  onOpenMore: () => void;
  /** When false, only the ⋯ control is shown (book chrome, Zen). */
  showViewToggle?: boolean;
  /** Accessible name of the ⋯ control. */
  moreLabel?: string;
};

export function ArticleReadingToolbar({
  view,
  onSwitchView,
  onOpenMore,
  showViewToggle = true,
  moreLabel = "More article actions",
}: ArticleReadingToolbarProps) {
  return (
    <div
      className={
        showViewToggle
          ? "article-toolbar"
          : "article-toolbar article-toolbar-zen"
      }
    >
      {showViewToggle && (
        <div className="toggle">
          <button
            type="button"
            className={view === "translation" ? "active" : ""}
            onClick={() => onSwitchView("translation")}
          >
            Translation
          </button>
          <button
            type="button"
            className={view === "original" ? "active" : ""}
            onClick={() => onSwitchView("original")}
          >
            Original
          </button>
        </div>
      )}
      <button
        type="button"
        className="more-button"
        aria-label={moreLabel}
        onClick={onOpenMore}
      >
        ⋯
      </button>
    </div>
  );
}
