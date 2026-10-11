import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArticleChromeDisclosure } from "../components/ArticleChromeDisclosure";
import { ArticlePageActions } from "../components/ArticlePageActions";
import { ArticlePageHeader } from "../components/ArticlePageHeader";
import { ArticleText } from "../components/ArticleText";
import { ArticleTranslationStatus } from "../components/ArticleTranslationStatus";
import { ArticleViewControls } from "../components/ArticleViewControls";
import { SentenceSheet } from "../components/SentenceSheet";
import { articleChromeCollapsible } from "../lib/articleChrome";
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
  const [actionsOpen, setActionsOpen] = useState(false);

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
  const chromeCollapsible = article
    ? articleChromeCollapsible(article, working)
    : false;
  const showChrome = !chromeCollapsible || actionsOpen;

  useEffect(() => {
    // Finished articles start collapsed; active/error runs keep chrome open.
    setActionsOpen(!chromeCollapsible);
  }, [chromeCollapsible]);

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
      {chromeCollapsible && (
        <ArticleChromeDisclosure
          open={actionsOpen}
          onToggle={() => setActionsOpen((open) => !open)}
        />
      )}
      {showChrome && (
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
