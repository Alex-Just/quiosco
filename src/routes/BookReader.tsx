import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { NavigateFunction } from "react-router-dom";
import { ArticleActionsSheet } from "../components/ArticleActionsSheet";
import { ArticleReadingToolbar } from "../components/ArticleReadingToolbar";
import { ArticleZenListenButton } from "../components/ArticleZenListenButton";
import { ArticleZenPane } from "../components/ArticleZenPane";
import { ArticleZenProgress } from "../components/ArticleZenProgress";
import { BookChapterSheet } from "../components/BookChapterSheet";
import { BookText } from "../components/BookText";
import { KosyncPromptBanner } from "../components/KosyncPrompt";
import { SentenceSheet } from "../components/SentenceSheet";
import {
  makeOnDelete,
  makeToggleArchive,
  makeToggleRead,
} from "../lib/articleActionHandlers";
import type { BookFinishProgress } from "../lib/bookFinish";
import {
  bookChapterBodyStarts,
  bookChapterStarts,
  bookFlatParagraphs,
  bookSentenceUnits,
  bookUnitStarts,
  paragraphComplete,
  unitsByParagraph,
} from "../lib/bookText";
import type { BookTranslationStatus } from "../lib/bookTranslation";
import { loadSettings } from "../lib/settings";
import type { ArticleStore } from "../lib/store";
import type { Article } from "../lib/types";
import { useArticleScroll } from "../lib/useArticleScroll";
import { type BookExportUiStatus, useBookExport } from "../lib/useBookExport";
import { useBookTranslation } from "../lib/useBookTranslation";
import { useKosyncPrompt } from "../lib/useKosyncPrompt";
import { useNarration } from "../lib/useNarration";
import { useSentenceSpeech } from "../lib/useSentenceSpeech";
import { useZenPosition } from "../lib/useZenPosition";
import { useZenSwipe } from "../lib/useZenSwipe";
import { loadZenAutoListen, saveZenAutoListen } from "../lib/zenAutoListen";
import { copyZenPageOriginal } from "../lib/zenCopyActions";
import { clampZenIndex } from "../lib/zenMode";
import { pairSourceWithTranslation } from "../lib/zenTranslationDisplay";

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

/** The finish run and the export own the status line while either is active. */
function finishStatusText(
  status: BookExportUiStatus,
  progress: BookFinishProgress | null,
): string | null {
  if (status === "exporting") return "Preparing EPUB…";
  if (status === "working") {
    return `Translating whole book — ${progress?.done ?? 0} / ${progress?.total ?? 0}`;
  }
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
  // Books always open in Zen, one sentence per screen like the article flow,
  // and a stored screen is restored inside it.
  const [zenMode, setZenMode] = useState(true);
  /** Zen screen = sentence unit index; null until the saved one is read. */
  const [zenUnit, setZenUnit] = useState<number | null>(null);
  const [settings] = useState(() => loadSettings());
  /**
   * Zen-only; off on a book's first open, on for every later open once the
   * book has translations saved. Cached translations work without a token.
   */
  const [translationMode, setTranslationMode] = useState(
    () => article.bookTranslationOn === true,
  );
  const [autoListen, setAutoListen] = useState(() => loadZenAutoListen());
  const [pageCopied, setPageCopied] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [chaptersOpen, setChaptersOpen] = useState(false);
  const [copied, setCopied] = useState<"none" | "original">("none");

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

  /** Zen screens: one source sentence each. */
  const paneParagraphs = useMemo(() => units.map((unit) => unit.text), [units]);
  /** Zen screen index of each chapter's title paragraph. */
  const chapterUnitStarts = useMemo(
    () => bookUnitStarts(units, chapterStarts),
    [chapterStarts, units],
  );
  /** First body unit of each chapter, for exact bilingual XPointer mapping. */
  const chapterBodyStarts = useMemo(
    () => bookChapterBodyStarts(units, chapterStarts, chapterUnitStarts),
    [units, chapterStarts, chapterUnitStarts],
  );

  const {
    menu,
    setMenu,
    hint,
    setHint,
    isSpeaking,
    isZenOriginalSpeaking,
    onListen,
    onListenZenOriginal,
    onCopySentence,
    stopSpeechForViewChange,
  } = useSentenceSpeech(translationMode ? "translation" : "original");

  /**
   * Recorded narration for this book, when a pack is stored. It replaces
   * synthesized speech for the original sentence on screen; the translation
   * view and articles keep using TTS.
   */
  const narration = useNarration({
    store,
    bookId: article.id,
    chapterUnitStarts,
  });
  const narrated = narration.ready;
  const { stop: stopNarration, toggle: toggleNarration, canPlay } = narration;

  // Import progress and failure surface as the reader's toast; the pack is
  // hundreds of megabytes, so silence would look like a dead button. A stored
  // pack that no longer fits the book reports here too.
  const importingNarration = useRef(false);
  useEffect(() => {
    if (narration.importing) {
      importingNarration.current = true;
      setHint("Importing audiobook…");
      return;
    }
    if (narration.error) {
      importingNarration.current = false;
      setHint(narration.error);
      return;
    }
    if (!importingNarration.current) return;
    importingNarration.current = false;
    setHint("Audiobook ready.");
  }, [narration.importing, narration.error, setHint]);

  const bookExport = useBookExport({
    store,
    article,
    settings,
    units,
    onExported: () => setHint("EPUB ready — check Downloads."),
    onExportFailed: () => setHint("EPUB export failed."),
  });

  const translation = useBookTranslation({
    store,
    article,
    settings,
    anchorUnit: zenUnit,
    // One translation job per book: a finish run suspends the prefetch.
    enabled: translationMode && bookExport.uiStatus !== "working",
    units,
    paragraphUnits,
  });

  const hasToken = Boolean(settings.appToken);
  const canTranslate = hasToken || article.bookTranslationOn === true;
  const currentUnit = zenUnit == null ? null : (units[zenUnit] ?? null);
  const displayedText =
    translationMode && zenUnit != null
      ? pairSourceWithTranslation(
          currentUnit?.text ?? "",
          translation.translations.get(zenUnit) ?? currentUnit?.text ?? "",
        )
      : undefined;
  // The finish run owns the status line while it is active (running, paused,
  // quota, auth) or while the export assembles; otherwise the translation
  // mode's own status shows.
  const finishActive =
    bookExport.uiStatus !== "idle" && bookExport.uiStatus !== "done";
  const statusText = finishActive
    ? finishStatusText(bookExport.uiStatus, bookExport.progress)
    : translationMode
      ? translationStatusText(
          translation.status,
          zenUnit == null ||
            paragraphComplete(units, [zenUnit], translation.translations),
        )
      : null;
  const zenListenText = currentUnit?.text ?? "";

  const onToggleZen = () => {
    // Zen and regular mode index speech differently (sentence unit vs flat
    // paragraph): stop the utterance before the highlight can land on an
    // unrelated paragraph.
    narration.stop();
    stopSpeechForViewChange();
    setZenMode((open) => !open);
  };

  // Full-screen document-level swipe steps Zen screens (the pane itself no
  // longer owns the gesture); pause it while an overlay is open.
  useZenSwipe({
    enabled:
      zenMode &&
      zenUnit != null &&
      paneParagraphs.length > 1 &&
      !moreOpen &&
      !chaptersOpen &&
      !menu,
    index: zenUnit ?? 0,
    total: paneParagraphs.length,
    onIndexChange: setZenUnit,
  });

  const onToggleTranslationMode = () => {
    narration.stop();
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
    // Latch: once a translation for this book is on screen, every later open
    // starts in translated Zen. Local-only, like the rest of the book row.
    if (!translationMode || article.bookTranslationOn === true) return;
    if (translation.translations.size === 0) return;
    void store.update(article.id, { bookTranslationOn: true });
  }, [
    translationMode,
    article.id,
    article.bookTranslationOn,
    translation.translations,
    store,
  ]);

  useEffect(() => {
    // Reset until the restore for a newly opened book finishes.
    if (article.id) setZenUnit(null);
  }, [article.id]);

  useEffect(() => {
    if (paneParagraphs.length <= 0) return;
    setZenUnit((index) =>
      index == null ? index : clampZenIndex(index, paneParagraphs.length),
    );
  }, [paneParagraphs.length]);

  const onZenRestored = useCallback((index: number) => {
    setZenUnit(index);
  }, []);

  // Speech follows the screen: turning the page stops whatever is speaking,
  // and with Auto on it starts the new sentence (same flow as articles). A
  // narrated book starts its own audio instead of TTS; Auto never turns the
  // page on its own, it only starts the page the reader is on.
  const prevZenUnit = useRef(zenUnit);
  useEffect(() => {
    if (prevZenUnit.current === zenUnit) return;
    prevZenUnit.current = zenUnit;
    stopNarration();
    stopSpeechForViewChange();
    if (!autoListen || !zenMode || zenUnit == null) return;
    if (narrated && canPlay(zenUnit)) {
      toggleNarration(zenUnit);
      return;
    }
    const text = units[zenUnit]?.text ?? "";
    if (!text) return;
    onListenZenOriginal(zenUnit, text);
  }, [
    zenUnit,
    autoListen,
    zenMode,
    units,
    narrated,
    canPlay,
    stopNarration,
    toggleNarration,
    stopSpeechForViewChange,
    onListenZenOriginal,
  ]);

  // The position keeps the article view name; its Zen screen index is what
  // resumes a book, and the scroll offset only matters once regular mode
  // renders.
  useArticleScroll(store, article.id, !zenMode, "original", noop);
  useZenPosition({
    store,
    articleId: article.id,
    totalParagraphs: paneParagraphs.length,
    view: "original",
    zenIndex: zenUnit,
    onRestored: onZenRestored,
  });

  const onKosyncJump = useCallback((index: number) => {
    setZenMode(true);
    setZenUnit(index);
  }, []);
  // Read-only: the PocketBook (or any KOReader) may have a further position.
  // The hook offers it; it never writes one back.
  const kosync = useKosyncPrompt({
    article,
    units,
    localIndex: zenUnit,
    chapterUnitStarts,
    chapterBodyStarts,
    appToken: settings.appToken,
    enabled: zenMode,
    onJump: onKosyncJump,
  });

  const onSelectChapter = (index: number) => {
    if (zenMode) {
      setZenUnit(chapterUnitStarts[index] ?? 0);
    } else {
      revealChapter(`book-chapter-${index}`);
    }
    setChaptersOpen(false);
  };

  return (
    <article
      className={zenMode ? "article article-zen" : "article"}
      data-translation-status={translationMode ? translation.status : undefined}
      data-finish-status={
        bookExport.uiStatus === "idle" ? undefined : bookExport.uiStatus
      }
    >
      {zenMode ? (
        zenUnit != null && (
          <ArticleZenProgress
            index={zenUnit}
            total={paneParagraphs.length}
            onOpenMore={() => setMoreOpen(true)}
            onDelete={onDelete}
            progressLabel="Book progress"
            moreLabel="More book actions"
            deleteLabel="Delete book"
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
      {kosync.prompt && (
        <KosyncPromptBanner
          device={kosync.prompt.device}
          percentage={kosync.prompt.percentage}
          onJump={kosync.jump}
          onDismiss={kosync.dismiss}
        />
      )}
      {zenMode ? (
        zenUnit == null ? (
          <p className="muted">Loading…</p>
        ) : (
          <>
            <ArticleZenPane
              paragraphs={paneParagraphs}
              index={zenUnit}
              onIndexChange={setZenUnit}
              isSpeaking={isSpeaking}
              onOpenMenu={setMenu}
              displayText={displayedText}
            />
            {statusText && <p className="muted zen-status">{statusText}</p>}
            <ArticleZenListenButton
              listening={
                canPlay(zenUnit)
                  ? narration.speakingUnit === zenUnit
                  : isZenOriginalSpeaking(zenUnit)
              }
              autoListen={autoListen}
              disabled={zenListenText.length === 0}
              copied={pageCopied}
              onClick={() => {
                if (canPlay(zenUnit)) {
                  toggleNarration(zenUnit);
                  return;
                }
                onListenZenOriginal(zenUnit, zenListenText);
              }}
              onCopy={() =>
                void copyZenPageOriginal(zenListenText, setPageCopied, setHint)
              }
              onAutoListenChange={(enabled) => {
                setAutoListen(enabled);
                saveZenAutoListen(enabled);
              }}
            />
          </>
        )
      ) : (
        <>
          {statusText && <p className="muted read-status">{statusText}</p>}
          <BookText
            chapters={chapters}
            paragraphs={paragraphs}
            chapterStarts={chapterStarts}
            isSpeaking={isSpeaking}
            onOpenMenu={setMenu}
          />
        </>
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
          onExportEpub={() => bookExport.exportNow()}
          onFinishExport={() => bookExport.startFinish()}
          onCancelFinish={() => bookExport.cancelFinish()}
          finishRunning={bookExport.uiStatus === "working"}
          exporting={bookExport.uiStatus === "exporting"}
          narrationReady={narrated}
          narrationImporting={narration.importing}
          onImportNarration={narration.load}
          onRemoveNarration={narration.remove}
          // In Zen the translation entry's hint already explains both
          // disabled items; in regular mode this entry carries it.
          finishExportHint={hasToken || zenMode ? null : MISSING_TOKEN_HINT}
          onClose={() => setMoreOpen(false)}
          onToggleRead={toggleRead}
          onToggleArchive={toggleArchive}
          onRetranslate={noop}
          onDelete={onDelete}
          onCopy={() => void copyBookText(article, setCopied)}
          onToggleZen={onToggleZen}
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
          isSpeaking={(paragraph, sentenceIndex) =>
            zenMode && canPlay(paragraph)
              ? narration.speakingUnit === paragraph
              : isSpeaking(paragraph, sentenceIndex)
          }
          onClose={() => setMenu(null)}
          onListen={() => {
            if (zenMode && menu && canPlay(menu.paragraph)) {
              toggleNarration(menu.paragraph);
              setMenu(null);
              return;
            }
            onListen();
          }}
          onCopySentence={onCopySentence}
        />
      )}
      {hint && <p className="toast">{hint}</p>}
    </article>
  );
}
