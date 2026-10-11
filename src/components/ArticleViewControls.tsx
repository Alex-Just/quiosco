import type { ArticleView } from "../lib/types";

type ArticleViewControlsProps = {
  view: ArticleView;
  onSwitchView: (view: ArticleView) => void;
  copied: "none" | "translation" | "original";
  translationBody: string;
  onCopy: (kind: "translation" | "original") => void;
};

export function ArticleViewControls({
  view,
  onSwitchView,
  copied,
  translationBody,
  onCopy,
}: ArticleViewControlsProps) {
  return (
    <>
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
      <div className="actions">
        <button
          type="button"
          onClick={() => onCopy("translation")}
          disabled={!translationBody}
        >
          {copied === "translation" ? "Copied!" : "Copy translation"}
        </button>
        <button type="button" onClick={() => onCopy("original")}>
          {copied === "original" ? "Copied!" : "Copy original"}
        </button>
      </div>
    </>
  );
}
