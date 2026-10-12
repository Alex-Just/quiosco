import type { ZenEndAction } from "../lib/zenEndActions";

type ArticleZenEndActionsProps = {
  actions: ZenEndAction[];
  onArchive: () => void;
  onDelete: () => void;
};

/** End-of-article actions under the Zen reading pane. */
export function ArticleZenEndActions({
  actions,
  onArchive,
  onDelete,
}: ArticleZenEndActionsProps) {
  return (
    <div className="zen-end">
      {actions.map((action) => (
        <button
          key={action}
          type="button"
          className={action === "delete" ? "danger" : ""}
          onClick={action === "delete" ? onDelete : onArchive}
        >
          {action === "delete" ? "Delete" : "Archive"}
        </button>
      ))}
    </div>
  );
}
