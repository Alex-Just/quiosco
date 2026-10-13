import { Fragment } from "react";
import {
  gapBeforeSentence,
  repairFlagMarkers,
  spaceFlagLines,
} from "../lib/flagLines";
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
  const sentences = splitSentences(repairFlagMarkers(paragraph));
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
        // Keep the gap as a sibling text node. Trailing blank lines inside
        // an inline <button> mis-wrap the next sibling (short lines and
        // ¿…? alike), so the next flag stanza starts mid-line.
        return (
          <Fragment
            // biome-ignore lint/suspicious/noArrayIndexKey: sentences have no stable id
            key={sentenceIndex}
          >
            <button
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
            </button>
            {next ? gapBeforeSentence(next) : null}
          </Fragment>
        );
      })}
    </p>
  );
}
