import { gapBeforeSentence, spaceFlagLines } from "../lib/flagLines";
import {
  splitLeadingNumber,
  splitSentences,
  stripSentenceMarkers,
} from "../lib/sentences";
import type { SentenceMenu } from "../lib/useSentenceSpeech";

type SentenceParagraphProps = {
  paragraph: string;
  paragraphIndex: number;
  totalParagraphs: number;
  isSpeaking: (paragraph: number, sentenceIndex: number) => boolean;
  onOpenMenu: (menu: SentenceMenu) => void;
};

/**
 * One paragraph of tappable sentences: the dimmed n/total marker when the
 * paragraph starts with an index, then a button per sentence.
 */
export function SentenceParagraph({
  paragraph,
  paragraphIndex,
  totalParagraphs,
  isSpeaking,
  onOpenMenu,
}: SentenceParagraphProps) {
  const sentences = splitSentences(paragraph);
  const first = sentences[0] ? splitLeadingNumber(sentences[0]) : null;
  return (
    <p className="para">
      {first?.number && (
        <span className="para-index">
          {first.number}/{totalParagraphs}
        </span>
      )}
      {sentences.map((sentence, sentenceIndex) => {
        const raw = sentenceIndex === 0 && first ? first.text : sentence;
        const next = sentences[sentenceIndex + 1];
        return (
          <button
            // biome-ignore lint/suspicious/noArrayIndexKey: sentences have no stable id
            key={sentenceIndex}
            type="button"
            className={
              isSpeaking(paragraphIndex, sentenceIndex)
                ? "sentence speaking"
                : "sentence"
            }
            onClick={() =>
              onOpenMenu({
                paragraph: paragraphIndex,
                sentenceIndex,
                sentence: stripSentenceMarkers(sentence),
              })
            }
          >
            {spaceFlagLines(raw)}
            {next ? gapBeforeSentence(next) : ""}
          </button>
        );
      })}
    </p>
  );
}
