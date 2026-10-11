import type { SentenceMenu } from "../lib/useSentenceSpeech";

type SentenceSheetProps = {
  menu: SentenceMenu;
  isSpeaking: (paragraph: number, sentenceIndex: number) => boolean;
  onClose: () => void;
  onListen: () => void;
  onCopySentence: () => void;
};

export function SentenceSheet({
  menu,
  isSpeaking,
  onClose,
  onListen,
  onCopySentence,
}: SentenceSheetProps) {
  return (
    <>
      {/* biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: backdrop tap closes the sheet; Escape is handled globally */}
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
          aria-label="Sentence actions"
        >
          <p className="sheet-sentence">{menu.sentence}</p>
          <div className="sheet-actions">
            <button type="button" className="primary" onClick={onListen}>
              {isSpeaking(menu.paragraph, menu.sentenceIndex)
                ? "Stop"
                : "Listen"}
            </button>
            <button type="button" onClick={onCopySentence}>
              Copy
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
