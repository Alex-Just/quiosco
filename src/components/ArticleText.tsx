import {
  splitLeadingNumber,
  splitSentences,
  stripSentenceMarkers,
} from "../lib/sentences";
import type { SentenceMenu } from "../lib/useSentenceSpeech";

type ArticleTextProps = {
  paragraphs: string[];
  isSpeaking: (paragraph: number, sentenceIndex: number) => boolean;
  onOpenMenu: (menu: SentenceMenu) => void;
};

export function ArticleText({
  paragraphs,
  isSpeaking,
  onOpenMenu,
}: ArticleTextProps) {
  return (
    <div className="article-text">
      {paragraphs.map((paragraph, paragraphIndex) => {
        const sentences = splitSentences(paragraph);
        const first = sentences[0] ? splitLeadingNumber(sentences[0]) : null;
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: sentences have no stable id
          <p className="para" key={paragraphIndex}>
            {first?.number && (
              <span className="para-index">
                {first.number}/{paragraphs.length}
              </span>
            )}
            {sentences.map((sentence, sentenceIndex) => (
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
                {sentenceIndex === 0 && first ? first.text : sentence}
                {sentenceIndex < sentences.length - 1 ? " " : ""}
              </button>
            ))}
          </p>
        );
      })}
    </div>
  );
}
