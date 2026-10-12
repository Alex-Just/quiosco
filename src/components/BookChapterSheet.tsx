import type { BookChapter } from "../lib/types";

type BookChapterSheetProps = {
  chapters: readonly BookChapter[];
  onSelect: (index: number) => void;
  onClose: () => void;
};

/** Bottom sheet listing the book's chapters; tapping one jumps to it. */
export function BookChapterSheet({
  chapters,
  onSelect,
  onClose,
}: BookChapterSheetProps) {
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: backdrop tap closes; matches SentenceSheet
    <div
      className="sheet-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Chapters"
      >
        <div className="sheet-list">
          {chapters.map((chapter, index) => (
            <button
              // biome-ignore lint/suspicious/noArrayIndexKey: chapters have no stable id
              key={index}
              type="button"
              onClick={() => onSelect(index)}
            >
              {chapter.title}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
