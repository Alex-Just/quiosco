import type { ArticleView } from "../lib/types";

type ArticleReadingToolbarProps = {
  view: ArticleView;
  onSwitchView: (view: ArticleView) => void;
  onOpenMore: () => void;
  /** When false, only the ⋯ control is shown (Zen mode). */
  showViewToggle?: boolean;
};

export function ArticleReadingToolbar({
  view,
  onSwitchView,
  onOpenMore,
  showViewToggle = true,
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
        aria-label="More article actions"
        onClick={onOpenMore}
      >
        ⋯
      </button>
    </div>
  );
}
