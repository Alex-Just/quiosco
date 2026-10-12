import type { SentenceMenu } from "../lib/useSentenceSpeech";
import { SentenceParagraph } from "./SentenceParagraph";

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
      {paragraphs.map((paragraph, paragraphIndex) => (
        <SentenceParagraph
          // biome-ignore lint/suspicious/noArrayIndexKey: paragraphs have no stable id
          key={paragraphIndex}
          paragraph={paragraph}
          paragraphIndex={paragraphIndex}
          totalParagraphs={paragraphs.length}
          isSpeaking={isSpeaking}
          onOpenMenu={onOpenMenu}
        />
      ))}
    </div>
  );
}
