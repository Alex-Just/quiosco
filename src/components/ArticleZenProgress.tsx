import { zenProgressLabel, zenProgressPercent } from "../lib/zenProgress";

type ArticleZenProgressProps = {
  index: number;
  total: number;
  onOpenMore: () => void;
};

/** Top-of-screen page count, solid progress line, and ⋯ menu for Zen. */
export function ArticleZenProgress({
  index,
  total,
  onOpenMore,
}: ArticleZenProgressProps) {
  if (total <= 0) return null;
  const label = zenProgressLabel(index, total);
  return (
    <div className="zen-progress">
      <div
        className="zen-progress-meter"
        role="progressbar"
        aria-label="Article progress"
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
      <button
        type="button"
        className="more-button zen-progress-more"
        aria-label="More article actions"
        onClick={onOpenMore}
      >
        ⋯
      </button>
    </div>
  );
}
