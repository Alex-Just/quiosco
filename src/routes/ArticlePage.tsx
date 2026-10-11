import { useCallback, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArticleActionsSheet } from "../components/ArticleActionsSheet";
import { ArticlePageActions } from "../components/ArticlePageActions";
import { ArticlePageHeader } from "../components/ArticlePageHeader";
import { ArticleReadingToolbar } from "../components/ArticleReadingToolbar";
import { ArticleText } from "../components/ArticleText";
import { ArticleTranslationStatus } from "../components/ArticleTranslationStatus";
import { ArticleViewControls } from "../components/ArticleViewControls";
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

export default function ArticlePage() {
  const store = useStore();
  const navigate = useNavigate();
  const { id } = useParams();
  const [view, setView] = useState<ArticleView>("translation");
  const [moreOpen, setMoreOpen] = useState(false);

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

  // Restore and persist this article's reading position.
  useArticleScroll(store, id, body.length > 0, view, setView);

  const switchView = useCallback(
    (next: ArticleView) => {
      if (next === view) return;
      stopSpeechForViewChange();
      setView(next);
    },
    [view, stopSpeechForViewChange],
  );

  if (!article) return <p className="muted">Loading…</p>;

  const paragraphs = bodyParagraphs(body);

  return (
    <article className="article">
      <ArticlePageHeader article={article} />
      {compactChrome ? (
        <ArticleReadingToolbar
          view={view}
          onSwitchView={switchView}
          onOpenMore={() => setMoreOpen(true)}
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
        <ArticleText
          paragraphs={paragraphs}
          isSpeaking={isSpeaking}
          onOpenMenu={setMenu}
        />
      ) : (
        <p className="muted">No translation yet.</p>
      )}
      {!working && (
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
      {moreOpen && compactChrome && (
        <ArticleActionsSheet
          article={article}
          translationBody={translationBody}
          copied={actions.copied}
          onClose={() => setMoreOpen(false)}
          onToggleRead={actions.toggleRead}
          onToggleArchive={actions.toggleArchive}
          onRetranslate={actions.onRetranslate}
          onDelete={actions.onDelete}
          onCopy={actions.copy}
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
