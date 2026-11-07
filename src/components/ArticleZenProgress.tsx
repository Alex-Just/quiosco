import { zenProgressLabel, zenProgressPercent } from "../lib/zenProgress";

type ArticleZenProgressProps = {
  index: number;
  total: number;
  onOpenMore: () => void;
  /** Shows the destructive action next to the ⋯ control when set. */
  onDelete?: () => void;
  /** Accessible name of the progress bar. */
  progressLabel?: string;
  /** Accessible name of the ⋯ control. */
  moreLabel?: string;
  /** Accessible name of the trash control. */
  deleteLabel?: string;
};

/** Top-of-screen page count, solid progress line, and ⋯ menu for Zen. */
export function ArticleZenProgress({
  index,
  total,
  onOpenMore,
  onDelete,
  progressLabel = "Article progress",
  moreLabel = "More article actions",
  deleteLabel = "Delete article",
}: ArticleZenProgressProps) {
  if (total <= 0) return null;
  const label = zenProgressLabel(index, total);
  return (
    <div className="zen-progress">
      <div
        className="zen-progress-meter"
        role="progressbar"
        aria-label={progressLabel}
        aria-valuemin={1}
        aria-valuemax={total}
        aria-valuenow={index + 1}
        aria-valuetext={label}
      >
        <span className="zen-progress-label">{label}</span>
        <div className="zen-progress-track">
          <div
            className="zen-progress-fill"
            style={{ width: zenProgressPercent(index, total) }}
          />
        </div>
      </div>
      {onDelete && (
        <button
          type="button"
          className="more-button zen-progress-delete"
          aria-label={deleteLabel}
          onClick={onDelete}
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M3 6h18" />
            <path d="M8 6V4h8v2" />
            <path d="M19 6l-1 14H6L5 6" />
            <path d="M10 11v5M14 11v5" />
          </svg>
        </button>
      )}
      <button
        type="button"
        className="more-button zen-progress-more"
        aria-label={moreLabel}
        onClick={onOpenMore}
      >
        ⋯
      </button>
    </div>
  );
}
