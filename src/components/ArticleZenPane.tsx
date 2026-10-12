import { useEffect } from "react";
import { gapBeforeSentence, spaceFlagLines } from "../lib/flagLines";
import {
  splitLeadingNumber,
  splitSentences,
  stripSentenceMarkers,
} from "../lib/sentences";
import type { SentenceMenu } from "../lib/useSentenceSpeech";
import { stepZenIndex } from "../lib/zenMode";

type ArticleZenPaneProps = {
  paragraphs: string[];
  index: number;
  onIndexChange: (index: number) => void;
  isSpeaking: (paragraph: number, sentenceIndex: number) => boolean;
  onOpenMenu: (menu: SentenceMenu) => void;
};

export function ArticleZenPane({
  paragraphs,
  index,
  onIndexChange,
  isSpeaking,
  onOpenMenu,
}: ArticleZenPaneProps) {
  const total = paragraphs.length;
  const paragraph = paragraphs[index] ?? "";

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const delta = event.key === "ArrowDown" ? 1 : -1;
        onIndexChange(stepZenIndex(index, total, delta));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, total, onIndexChange]);

  const sentences = splitSentences(paragraph);
  const first = sentences[0] ? splitLeadingNumber(sentences[0]) : null;

  return (
    <div className="article-text zen-pane">
      <p className="para">
        {sentences.map((sentence, sentenceIndex) => {
          const raw = sentenceIndex === 0 && first ? first.text : sentence;
          const next = sentences[sentenceIndex + 1];
          return (
            <button
              // biome-ignore lint/suspicious/noArrayIndexKey: sentences have no stable id
              key={sentenceIndex}
              type="button"
              className={
                isSpeaking(index, sentenceIndex)
                  ? "sentence speaking"
                  : "sentence"
              }
              onClick={() =>
                onOpenMenu({
                  paragraph: index,
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
    </div>
  );
}
