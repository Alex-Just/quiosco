import { useCallback, useEffect, useMemo, useState } from "react";
import type { NavigateFunction } from "react-router-dom";
import { ArticleActionsSheet } from "../components/ArticleActionsSheet";
import { ArticleReadingToolbar } from "../components/ArticleReadingToolbar";
import { ArticleZenPane } from "../components/ArticleZenPane";
import { ArticleZenProgress } from "../components/ArticleZenProgress";
import { BookChapterSheet } from "../components/BookChapterSheet";
import { BookText } from "../components/BookText";
import { SentenceSheet } from "../components/SentenceSheet";
import {
  makeOnDelete,
  makeToggleArchive,
  makeToggleRead,
} from "../lib/articleActionHandlers";
import {
  assembleTranslatedParagraph,
  bookChapterStarts,
  bookFlatParagraphs,
  bookSentenceUnits,
  paragraphComplete,
  unitsByParagraph,
} from "../lib/bookText";
import type { BookTranslationStatus } from "../lib/bookTranslation";
import { loadSettings } from "../lib/settings";
import type { ArticleStore } from "../lib/store";
import type { Article } from "../lib/types";
import { useArticleScroll } from "../lib/useArticleScroll";
import { useBookTranslation } from "../lib/useBookTranslation";
import { useSentenceSpeech } from "../lib/useSentenceSpeech";
import { useZenPosition } from "../lib/useZenPosition";
import { useZenSwipe } from "../lib/useZenSwipe";

const COPY_RESET_MS = 1500;

/** Frames one chapter jump keeps watching for layout shifts before giving up. */
const CHAPTER_SCROLL_FRAMES = 10;

/**
 * Scroll a regular-mode chapter anchor into view and keep watching for a few
 * frames. Chapter sections carry `content-visibility: auto`, so off-screen
 * chapters are estimated at 800 px and a far jump lands on that estimate while
 * the skipped sections between re-render and move the target; re-scrolling
 * whenever the anchor is out of the viewport (bounded) lands it for real.
 */
function revealChapter(id: string): void {
  let frames = 0;
  const step = () => {
    const target = document.getElementById(id);
    if (!target) return;
    const rect = target.getBoundingClientRect();
    if (rect.top < -1 || rect.top >= window.innerHeight) {
      target.scrollIntoView();
    }
    frames += 1;
    if (frames < CHAPTER_SCROLL_FRAMES) requestAnimationFrame(step);
  };
  step();
}

// Books have a single view and no article-only actions; the toolbar and the
// scroll helper still take callbacks that never fire.
const noop = () => {};

/** Copy original for a book: its flat paragraphs, chapter titles included. */
async function copyBookText(
  article: Article,
  setCopied: (value: "none" | "original") => void,
): Promise<void> {
  const value = bookFlatParagraphs(article).join("\n\n");
  if (!value) return;
  await navigator.clipboard.writeText(value);
  setCopied("original");
  window.setTimeout(() => setCopied("none"), COPY_RESET_MS);
}

/** The quiet line under the pane while translation mode is on. Null: hide. */
function translationStatusText(
  status: BookTranslationStatus,
  complete: boolean,
): string | null {
  if (status === "working") return complete ? null : "Translating…";
  if (status === "paused") return "Translation paused";
  if (status === "quota") return "Daily translation budget reached.";
  if (status === "auth") return "Check the app token in Settings.";
  return null;
}

const MISSING_TOKEN_HINT = "Set the app token in Settings to translate.";

type BookReaderProps = {
  store: ArticleStore;
  article: Article;
  setArticle: (article: Article) => void;
  navigate: NavigateFunction;
};

export default function BookReader({
  store,
  article,
  setArticle,
  navigate,
}: BookReaderProps) {
  // Books always open in Zen; a stored paragraph is restored inside it.
  const [zenMode, setZenMode] = useState(true);
  /** null until the saved Zen index has been read (avoids saving 0 too early). */
  const [zenIndex, setZenIndex] = useState<number | null>(null);
  /** Zen-only, off on every open: the user turns translation on explicitly. */
  const [translationMode, setTranslationMode] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [chaptersOpen, setChaptersOpen] = useState(false);
  const [copied, setCopied] = useState<"none" | "original">("none");
  const [settings] = useState(() => loadSettings());

  const chapters = article.chapters ?? [];
  // One flatten and sentence split per book, shared with the translation hook
  // below: keyed on the chapters (or the body fallback) so re-renders of the
  // reader do not redo the whole book, and identity changes that do matter
  // still recompute.
  // biome-ignore lint/correctness/useExhaustiveDependencies: article.chapters and article.text are the inputs the hook body reads
  const { paragraphs, chapterStarts, units, paragraphUnits } = useMemo(() => {
    const paragraphs = bookFlatParagraphs(article);
    const units = bookSentenceUnits(paragraphs);
    return {
      paragraphs,
      chapterStarts: bookChapterStarts(article),
      units,
      paragraphUnits: unitsByParagraph(units),
    };
  }, [article.chapters, article.text]);

  const {
    menu,
    setMenu,
    hint,
    isSpeaking,
    onListen,
    onCopySentence,
    stopSpeechForViewChange,
  } = useSentenceSpeech(translationMode ? "translation" : "original");

  const translation = useBookTranslation({
    store,
    article,
    settings,
    zenIndex,
    enabled: translationMode,
    units,
    paragraphUnits,
  });

  const canTranslate = Boolean(settings.appToken);
  const currentUnits =
    zenIndex == null ? [] : (paragraphUnits.get(zenIndex) ?? []);
  const translatedParagraph =
    translationMode && zenIndex != null
      ? assembleTranslatedParagraph(
          units,
          currentUnits,
          translation.translations,
        )
      : undefined;
  const statusText = translationMode
    ? translationStatusText(
        translation.status,
        paragraphComplete(units, currentUnits, translation.translations),
      )
    : null;

  // Full-screen document-level swipe steps Zen paragraphs (the pane itself no
  // longer owns the gesture); pause it while an overlay is open.
  useZenSwipe({
    enabled:
      zenMode &&
      zenIndex != null &&
      paragraphs.length > 1 &&
      !moreOpen &&
      !chaptersOpen &&
      !menu,
    index: zenIndex ?? 0,
    total: paragraphs.length,
    onIndexChange: setZenIndex,
  });

  const onToggleTranslationMode = () => {
    stopSpeechForViewChange();
    setTranslationMode((on) => !on);
  };

  const toggleRead = makeToggleRead(store, article, setArticle);
  const toggleArchive = makeToggleArchive(store, article, setArticle);
  const onDelete = makeOnDelete(store, article, navigate);

  useEffect(() => {
    document.body.classList.toggle("zen-active", zenMode);
    return () => {
      document.body.classList.remove("zen-active");
    };
  }, [zenMode]);

  useEffect(() => {
    // Translation is Zen-only: leaving Zen disposes the session so it stops
    // spending budget and the speech view falls back to the source text.
    if (!zenMode) setTranslationMode(false);
  }, [zenMode]);

  useEffect(() => {
    // Reset until the restore for a newly opened book finishes.
    if (article.id) setZenIndex(null);
  }, [article.id]);

  const onZenRestored = useCallback((index: number) => {
    setZenIndex(index);
  }, []);

  // The position keeps the article view name; its Zen index is what resumes a
  // book, and the scroll offset only matters once regular mode renders.
  useArticleScroll(store, article.id, !zenMode, "original", noop);
  useZenPosition({
    store,
    articleId: article.id,
    totalParagraphs: paragraphs.length,
    view: "original",
    zenIndex,
    onRestored: onZenRestored,
  });

  const onSelectChapter = (index: number) => {
    if (zenMode) {
      const start = chapterStarts[index];
      if (start != null) setZenIndex(start);
    } else {
      revealChapter(`book-chapter-${index}`);
    }
    setChaptersOpen(false);
  };

  return (
    <article
      className={zenMode ? "article article-zen" : "article"}
      data-translation-status={translationMode ? translation.status : undefined}
    >
      {zenMode ? (
        zenIndex != null && (
          <ArticleZenProgress
            index={zenIndex}
            total={paragraphs.length}
            onOpenMore={() => setMoreOpen(true)}
            progressLabel="Book progress"
            moreLabel="More book actions"
          />
        )
      ) : (
        <ArticleReadingToolbar
          view="original"
          onSwitchView={noop}
          onOpenMore={() => setMoreOpen(true)}
          showViewToggle={false}
          moreLabel="More book actions"
        />
      )}
      {zenMode ? (
        zenIndex == null ? (
          <p className="muted">Loading…</p>
        ) : (
          <>
            <ArticleZenPane
              paragraphs={paragraphs}
              index={zenIndex}
              onIndexChange={setZenIndex}
              isSpeaking={isSpeaking}
              onOpenMenu={setMenu}
              displayText={translatedParagraph}
            />
            {statusText && <p className="muted zen-status">{statusText}</p>}
          </>
        )
      ) : (
        <BookText
          chapters={chapters}
          paragraphs={paragraphs}
          chapterStarts={chapterStarts}
          isSpeaking={isSpeaking}
          onOpenMenu={setMenu}
        />
      )}
      {moreOpen && (
        <ArticleActionsSheet
          article={article}
          translationBody=""
          copied={copied}
          zenMode={zenMode}
          zenAvailable
          kind="book"
          chaptersAvailable={chapters.length > 0}
          onOpenChapters={() => setChaptersOpen(true)}
          translationMode={translationMode}
          onToggleTranslationMode={
            zenMode ? onToggleTranslationMode : undefined
          }
          translationHint={canTranslate ? null : MISSING_TOKEN_HINT}
          onClose={() => setMoreOpen(false)}
          onToggleRead={toggleRead}
          onToggleArchive={toggleArchive}
          onRetranslate={noop}
          onDelete={onDelete}
          onCopy={() => void copyBookText(article, setCopied)}
          onToggleZen={() => setZenMode((open) => !open)}
        />
      )}
      {chaptersOpen && (
        <BookChapterSheet
          chapters={chapters}
          onSelect={onSelectChapter}
          onClose={() => setChaptersOpen(false)}
        />
      )}
      {menu && (
        <SentenceSheet
          menu={menu}
          isSpeaking={isSpeaking}
          onClose={() => setMenu(null)}
          onListen={onListen}
          onCopySentence={onCopySentence}
        />
      )}
      {hint && <p className="toast">{hint}</p>}
    </article>
  );
}
