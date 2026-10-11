import type { ArticleView } from "../lib/types";

type ArticleReadingToolbarProps = {
  view: ArticleView;
  onSwitchView: (view: ArticleView) => void;
  onOpenMore: () => void;
};

export function ArticleReadingToolbar({
  view,
  onSwitchView,
  onOpenMore,
}: ArticleReadingToolbarProps) {
  return (
    <div className="article-toolbar">
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
