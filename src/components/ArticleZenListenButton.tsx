/** U+2398 NEXT PAGE — reads as a small clipboard glyph on Android Chrome. */
const ZEN_COPY_ICON = "\u2398";
/** Brief success mark while the Copied aria-label is active. */
const ZEN_COPY_DONE_ICON = "\u2713";

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
        {copied ? ZEN_COPY_DONE_ICON : ZEN_COPY_ICON}
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
