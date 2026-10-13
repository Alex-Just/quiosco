type ArticleZenListenButtonProps = {
  listening: boolean;
  autoListen: boolean;
  disabled?: boolean;
  copied?: boolean;
  onClick: () => void;
  onCopy: () => void;
  onAutoListenChange: (enabled: boolean) => void;
};

/** Dim bottom-right control to copy or speak the original Zen page text. */
export function ArticleZenListenButton({
  listening,
  autoListen,
  disabled = false,
  copied = false,
  onClick,
  onCopy,
  onAutoListenChange,
}: ArticleZenListenButtonProps) {
  return (
    <fieldset className="zen-listen">
      <legend>Listen</legend>
      <button
        type="button"
        className="zen-listen-copy"
        aria-label={copied ? "Copied" : "Copy original page"}
        disabled={disabled}
        onClick={onCopy}
      >
        {copied ? "Copied" : "Copy"}
      </button>
      <label className="zen-listen-auto">
        <input
          type="checkbox"
          checked={autoListen}
          aria-label="Auto-listen on each page"
          onChange={(event) => onAutoListenChange(event.target.checked)}
        />
        Auto
      </label>
      <button
        type="button"
        className="zen-listen-action"
        aria-label={listening ? "Stop listening" : "Listen to original"}
        disabled={disabled}
        onClick={onClick}
      >
        {listening ? "Stop" : "Listen"}
      </button>
    </fieldset>
  );
}
