type ArticleZenListenButtonProps = {
  listening: boolean;
  autoListen: boolean;
  disabled?: boolean;
  onClick: () => void;
  onAutoListenChange: (enabled: boolean) => void;
};

/** Dim bottom-right control to speak the original text of the Zen page. */
export function ArticleZenListenButton({
  listening,
  autoListen,
  disabled = false,
  onClick,
  onAutoListenChange,
}: ArticleZenListenButtonProps) {
  return (
    <fieldset className="zen-listen">
      <legend>Listen</legend>
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
