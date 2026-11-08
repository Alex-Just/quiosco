type KosyncPromptBannerProps = {
  device: string;
  percentage: number;
  onJump: () => void;
  onDismiss: () => void;
};

/**
 * Read-only offer: KOReader has a further position for this book. It never
 * changes the page on its own.
 */
export function KosyncPromptBanner({
  device,
  percentage,
  onJump,
  onDismiss,
}: KosyncPromptBannerProps) {
  return (
    <aside
      className="kosync-prompt"
      aria-label="KOReader progress"
      aria-live="polite"
    >
      <p>
        <strong>{device}</strong> is at {Math.round(percentage * 100)}% in this
        book.
      </p>
      <div className="kosync-prompt-actions">
        <button type="button" className="primary" onClick={onJump}>
          Jump there
        </button>
        <button type="button" onClick={onDismiss}>
          Not now
        </button>
      </div>
    </aside>
  );
}
