import { zenProgressLabel, zenProgressPercent } from "../lib/zenProgress";

type ArticleZenProgressProps = {
  index: number;
  total: number;
};

/** Top-of-screen page count and solid progress line for Zen reading. */
export function ArticleZenProgress({ index, total }: ArticleZenProgressProps) {
  if (total <= 0) return null;
  const label = zenProgressLabel(index, total);
  return (
    <div
      className="zen-progress"
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
  );
}
