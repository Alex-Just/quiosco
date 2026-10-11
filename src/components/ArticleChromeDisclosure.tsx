type ArticleChromeDisclosureProps = {
  open: boolean;
  onToggle: () => void;
};

export function ArticleChromeDisclosure({
  open,
  onToggle,
}: ArticleChromeDisclosureProps) {
  return (
    <button
      type="button"
      className="chrome-disclosure"
      aria-expanded={open}
      onClick={onToggle}
    >
      Article actions
      <span className="chrome-disclosure-chevron" aria-hidden="true">
        {open ? "▴" : "▾"}
      </span>
    </button>
  );
}
