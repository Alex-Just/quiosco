import { Fragment, useEffect } from "react";
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
  /** Rendered (and split into sentences) instead of `paragraphs[index]`. */
  displayText?: string;
};

export function ArticleZenPane({
  paragraphs,
  index,
  onIndexChange,
  isSpeaking,
  onOpenMenu,
  displayText,
}: ArticleZenPaneProps) {
  const total = paragraphs.length;
  const paragraph = displayText ?? paragraphs[index] ?? "";

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
              </button>
              {next ? gapBeforeSentence(next) : null}
            </Fragment>
          );
        })}
      </p>
    </div>
  );
}
