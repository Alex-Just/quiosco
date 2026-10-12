import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArticleActionsSheet } from "../components/ArticleActionsSheet";
import { ArticlePageActions } from "../components/ArticlePageActions";
import { ArticlePageHeader } from "../components/ArticlePageHeader";
import { ArticleReadingToolbar } from "../components/ArticleReadingToolbar";
import { ArticleText } from "../components/ArticleText";
import { ArticleTranslationStatus } from "../components/ArticleTranslationStatus";
import { ArticleViewControls } from "../components/ArticleViewControls";
import { ArticleZenEndActions } from "../components/ArticleZenEndActions";
import { ArticleZenPane } from "../components/ArticleZenPane";
import { SentenceSheet } from "../components/SentenceSheet";
import { articleChromeCompact } from "../lib/articleChrome";
import {
  articleBody,
  bodyParagraphs,
  joinTranslationBody,
} from "../lib/articleDisplayHelpers";
import type { ArticleView } from "../lib/types";
import { useArticleActions } from "../lib/useArticleActions";
import { useArticleDocument } from "../lib/useArticleDocument";
import { useArticleScroll } from "../lib/useArticleScroll";
import { useSentenceSpeech } from "../lib/useSentenceSpeech";
import { useStore } from "../lib/useStore";
import { useZenPosition } from "../lib/useZenPosition";
import { isZenEndPage, zenEndActions } from "../lib/zenEndActions";
import { clampZenIndex } from "../lib/zenMode";

export default function ArticlePage() {
  const store = useStore();
  const navigate = useNavigate();
  const { id } = useParams();
  const [view, setView] = useState<ArticleView>("translation");
  const [moreOpen, setMoreOpen] = useState(false);
  const [zenMode, setZenMode] = useState(false);
  /** null until the saved Zen index has been read (avoids saving 0 too early). */
  const [zenIndex, setZenIndex] = useState<number | null>(null);

  const { article, setArticle, now, running } = useArticleDocument(
    store,
    id,
    navigate,
  );

  const actions = useArticleActions(store, article, setArticle, navigate);
  const {
    menu,
    setMenu,
    hint,
    isSpeaking,
    onListen,
    onCopySentence,
    stopSpeechForViewChange,
  } = useSentenceSpeech(view);

  const working = running || actions.busy;
  const compactChrome = article
    ? articleChromeCompact(article, working)
    : false;

  // The streamed tail of the chunk in flight is shown (and copied) after the
  // committed chunks; it is replaced by the full chunk when it lands.
  const translationBody = article ? joinTranslationBody(article) : "";
  const body = article ? articleBody(article, view) : "";
  const paragraphs = bodyParagraphs(body);
  const zenAvailable = compactChrome && paragraphs.length > 0;

  useEffect(() => {
    // Reset until restore finishes for the newly opened article.
    if (id !== undefined) setZenIndex(null);
  }, [id]);

  useEffect(() => {
    if (paragraphs.length <= 0) return;
    setZenIndex((index) =>
      index == null ? index : clampZenIndex(index, paragraphs.length),
    );
  }, [paragraphs.length]);

  // Finished articles open in Zen; leave Zen off when it is not available.
  useEffect(() => {
    if (!id) {
      setZenMode(false);
      return;
    }
    setZenMode(zenAvailable);
  }, [id, zenAvailable]);

  useEffect(() => {
    document.body.classList.toggle("zen-active", zenMode);
    return () => {
      document.body.classList.remove("zen-active");
    };
  }, [zenMode]);

  const onZenRestored = useCallback((index: number) => {
    setZenIndex(index);
  }, []);

  // Restore and persist the reading position; skip scroll while Zen owns nav.
  useArticleScroll(store, id, body.length > 0 && !zenMode, view, setView);
  useZenPosition({
    store,
    articleId: id,
    // Wait until the loaded article matches the route id.
    totalParagraphs: article?.id === id ? paragraphs.length : 0,
    view,
    zenIndex,
    onRestored: onZenRestored,
  });

  const switchView = useCallback(
    (next: ArticleView) => {
      if (next === view) return;
      stopSpeechForViewChange();
      setView(next);
    },
    [view, stopSpeechForViewChange],
  );

  if (!article) return <p className="muted">Loading…</p>;

  const showMoreSheet = moreOpen && (compactChrome || zenMode);

  return (
    <article className={zenMode ? "article article-zen" : "article"}>
      {!zenMode && <ArticlePageHeader article={article} />}
      {zenMode || compactChrome ? (
        <ArticleReadingToolbar
          view={view}
          onSwitchView={switchView}
          onOpenMore={() => setMoreOpen(true)}
          showViewToggle={!zenMode}
        />
      ) : (
        <>
          <ArticlePageActions
            article={article}
            working={working}
            onToggleRead={actions.toggleRead}
            onToggleArchive={actions.toggleArchive}
            onCancel={actions.onCancel}
            onRetranslate={actions.onRetranslate}
            onDelete={actions.onDelete}
          />
          <ArticleTranslationStatus article={article} now={now} />
          <ArticleViewControls
            view={view}
            onSwitchView={switchView}
            copied={actions.copied}
            translationBody={translationBody}
            onCopy={actions.copy}
          />
        </>
      )}
      {body ? (
        zenMode ? (
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
              />
              {isZenEndPage(zenIndex, paragraphs.length) && (
                <ArticleZenEndActions
                  actions={zenEndActions(article)}
                  onArchive={actions.onArchiveAndLeave}
                  onDelete={actions.onDelete}
                />
              )}
            </>
          )
        ) : (
          <ArticleText
            paragraphs={paragraphs}
            isSpeaking={isSpeaking}
            onOpenMenu={setMenu}
          />
        )
      ) : (
        <p className="muted">No translation yet.</p>
      )}
      {!working && !zenMode && (
        <div className="article-end">
          <button
            type="button"
            className={article.status === "read" ? "" : "primary"}
            onClick={actions.toggleRead}
          >
            {article.status === "read" ? "Mark as unread" : "Mark as read"}
          </button>
        </div>
      )}
      {showMoreSheet && (
        <ArticleActionsSheet
          article={article}
          translationBody={translationBody}
          copied={actions.copied}
          zenMode={zenMode}
          zenAvailable={zenAvailable || zenMode}
          onClose={() => setMoreOpen(false)}
          onToggleRead={actions.toggleRead}
          onToggleArchive={actions.toggleArchive}
          onRetranslate={actions.onRetranslate}
          onDelete={actions.onDelete}
          onCopy={actions.copy}
          onToggleZen={() => setZenMode((open) => !open)}
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
