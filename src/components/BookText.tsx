import type { BookChapter } from "../lib/types";
import type { SentenceMenu } from "../lib/useSentenceSpeech";
import { SentenceParagraph } from "./SentenceParagraph";

type BookTextProps = {
  chapters: readonly BookChapter[];
  /** Flat list from `bookFlatParagraphs`: each chapter title then its body. */
  paragraphs: readonly string[];
  /** Flat index of each chapter title in `paragraphs`, in chapter order. */
  chapterStarts: readonly number[];
  isSpeaking: (paragraph: number, sentenceIndex: number) => boolean;
  onOpenMenu: (menu: SentenceMenu) => void;
};

type ChapterParts = {
  title: string;
  paragraphs: string[];
  /** Flat index of the chapter title in `paragraphs`. */
  start: number;
};

/**
 * Regular (non-Zen) book body: one section per chapter, each with its title
 * and its paragraphs. Paragraph indexes are the flat indexes of
 * `bookFlatParagraphs` (chapter title first) and drive the dimmed n/total
 * marker and the sentence speech highlight. Zen indexes sentence units
 * instead, so speech is stopped when switching between the two views.
 */
export function BookText({
  chapters,
  paragraphs,
  chapterStarts,
  isSpeaking,
  onOpenMenu,
}: BookTextProps) {
  // Slice each chapter body from the flat list the reader already computed:
  // the body is exactly `[title, ...bodyParagraphs]` per chapter, so this
  // never re-splits chapter text on a render.
  const parts: ChapterParts[] = chapters.map((chapter, index) => {
    const start = chapterStarts[index] ?? 0;
    const end = chapterStarts[index + 1] ?? paragraphs.length;
    return {
      title: chapter.title,
      paragraphs: paragraphs.slice(start + 1, end),
      start,
    };
  });
  const totalParagraphs = paragraphs.length;

  return (
    <div className="article-text">
      {parts.map((part, index) => (
        <section
          // biome-ignore lint/suspicious/noArrayIndexKey: chapters have no stable id
          key={index}
          className="book-chapter"
          id={`book-chapter-${index}`}
        >
          <h2>{part.title}</h2>
          {part.paragraphs.map((paragraph, paragraphIndex) => (
            <SentenceParagraph
              // biome-ignore lint/suspicious/noArrayIndexKey: paragraphs have no stable id
              key={paragraphIndex}
              paragraph={paragraph}
              paragraphIndex={part.start + 1 + paragraphIndex}
              totalParagraphs={totalParagraphs}
              isSpeaking={isSpeaking}
              onOpenMenu={onOpenMenu}
            />
          ))}
        </section>
      ))}
    </div>
  );
}
