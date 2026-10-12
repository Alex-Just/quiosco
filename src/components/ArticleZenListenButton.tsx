type ArticleZenListenButtonProps = {
  listening: boolean;
  disabled?: boolean;
  onClick: () => void;
};

/** Dim bottom-right control to speak the original text of the Zen page. */
export function ArticleZenListenButton({
  listening,
  disabled = false,
  onClick,
}: ArticleZenListenButtonProps) {
  return (
    <button
      type="button"
      className="zen-listen"
      aria-label={listening ? "Stop listening" : "Listen to original"}
      disabled={disabled}
      onClick={onClick}
    >
      {listening ? "Stop" : "Listen"}
    </button>
  );
}
