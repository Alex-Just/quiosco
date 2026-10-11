import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { originalText } from "../lib/article";
import {
  formatDateTime,
  formatDurationMs,
  formatPhaseTimings,
} from "../lib/format";
import {
  splitLeadingNumber,
  splitSentences,
  stripSentenceMarkers,
} from "../lib/sentences";
import { loadSettings } from "../lib/settings";
import {
  canSpeak,
  isCancellation,
  ORIGINAL_LANG,
  speakSentence,
  speechLangFor,
  stopSpeaking,
} from "../lib/speech";
import {
  cancelTranslation,
  hasRunningTranslation,
  translateArticle,
} from "../lib/translateArticle";
import type { Article, ArticleView } from "../lib/types";
import { useArticleScroll } from "../lib/useArticleScroll";
import { useStore } from "../lib/useStore";

const STALE_RUN_MS = 10 * 60_000;
const PHASE_TICK_MS = 1000;

export default function ArticlePage() {
  const store = useStore();
  const navigate = useNavigate();
  const { id } = useParams();
  const [article, setArticle] = useState<Article | null>(null);
  const [view, setView] = useState<ArticleView>("translation");
  const [copied, setCopied] = useState<"none" | "translation" | "original">(
    "none",
  );
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState<{
    paragraph: number;
    sentenceIndex: number;
    sentence: string;
  } | null>(null);
  const [speaking, setSpeaking] = useState<{
    paragraph: number;
    sentenceIndex: number;
  } | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // Invalidates stale utterance callbacks: a replaced or cancelled utterance
  // may still fire end/error, and those must not clear the new highlight.
  const speechRun = useRef(0);

  useEffect(() => {
    if (!store || !id) return;
    let cancelled = false;
    void (async () => {
      const loaded = await store.get(id);
      if (cancelled) return;
      if (!loaded) {
        navigate("/", { replace: true });
        return;
      }
      setArticle(loaded);
    })();
    return () => {
      cancelled = true;
    };
  }, [store, id, navigate]);

  useEffect(() => {
    if (!store || !id) return;
    const reload = () => {
      void (async () => {
        const fresh = await store.get(id);
        if (!fresh) {
          navigate("/", { replace: true });
          return;
        }
        setArticle(fresh);
      })();
    };
    window.addEventListener("quiosco:sync", reload);
    return () => window.removeEventListener("quiosco:sync", reload);
  }, [store, id, navigate]);

  const running = article?.translationStatus === "running";
  const working = running || busy;
  useEffect(() => {
    if (!working || !article?.phaseStartedAt) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), PHASE_TICK_MS);
    return () => window.clearInterval(timer);
  }, [working, article?.phaseStartedAt]);
  useEffect(() => {
    if (!store || !id || !working) return;
    const timer = window.setInterval(() => {
      void (async () => {
        const fresh = await store.get(id);
        if (!fresh) {
          navigate("/", { replace: true });
          return;
        }
        // A run interrupted mid-flight (tab closed/reloaded) would otherwise
        // leave "running" forever and keep the translate button disabled.
        // store.update bumps updatedAt on every write, so a long-stale
        // timestamp means no live run (worst-case live gap is ~6 min: 3
        // attempts × 120 s timeout).
        if (
          fresh.translationStatus === "running" &&
          Date.now() - fresh.updatedAt > STALE_RUN_MS
        ) {
          const recovered = await store.update(id, {
            translationStatus: "error",
            error: "Translation was interrupted — resume to continue.",
          });
          setArticle(recovered);
          return;
        }
        setArticle(fresh);
      })();
    }, 1000);
    return () => window.clearInterval(timer);
  }, [store, id, working, navigate]);

  // Speech belongs to the page that started it: stop it on navigation and
  // when the visible text changes.
  useEffect(() => () => stopSpeaking(), []);
  useEffect(() => {
    if (!menu) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenu(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu]);
  useEffect(() => {
    if (!hint) return;
    const timer = window.setTimeout(() => setHint(null), 4000);
    return () => window.clearTimeout(timer);
  }, [hint]);

  // The streamed tail of the chunk in flight is shown (and copied) after the
  // committed chunks; it is replaced by the full chunk when it lands.
  const translationBody = article
    ? [article.translation, article.partial]
        .filter((value): value is string => Boolean(value))
        .join("\n\n")
    : "";
  const body = article
    ? view === "translation"
      ? translationBody
      : originalText(article)
    : "";

  // Restore and persist this article's reading position.
  useArticleScroll(store, id, body.length > 0, view, setView);

  if (!article) return <p className="muted">Loading…</p>;

  async function toggleRead() {
    if (!store || !article) return;
    setArticle(
      await store.update(article.id, {
        status: article.status === "read" ? "unread" : "read",
      }),
    );
  }

  async function toggleArchive() {
    if (!store || !article) return;
    setArticle(
      await store.update(article.id, {
        status: article.status === "archived" ? "unread" : "archived",
      }),
    );
  }

  async function onDelete() {
    if (!store || !article) return;
    if (!window.confirm("Delete this article?")) return;
    await store.remove(article.id);
    navigate("/");
  }

  function onCancel() {
    if (!article || !store) return;
    if (hasRunningTranslation(article.id)) {
      cancelTranslation(article.id);
      return;
    }
    // The run is not alive in this session (the app was closed or reloaded, or
    // another device started it): return the article to a resumable state
    // instead of waiting out the stale-run lease.
    void (async () => {
      setArticle(
        await store.update(article.id, {
          translationStatus: "pending",
          translationPhase: null,
          phaseStartedAt: null,
          partial: null,
          error: null,
        }),
      );
    })();
  }

  async function onRetranslate() {
    if (!store || !article || busy) return;
    const settings = loadSettings();
    if (!settings.appToken) {
      navigate("/settings");
      return;
    }
    setBusy(true);
    try {
      // A finished translation is re-run from scratch (the target language or
      // rules may have changed); partial/error states resume from the stored
      // position.
      const done = article.translationStatus === "done";
      const fresh = await store.update(article.id, {
        translationStatus: "pending",
        error: null,
        ...(done
          ? { translation: null, translatedChunks: 0, totalChunks: 0 }
          : {}),
      });
      setArticle(fresh);
      await translateArticle(store, fresh, settings);
      const reloaded = await store.get(article.id);
      if (reloaded) setArticle(reloaded);
    } finally {
      setBusy(false);
    }
  }

  async function copy(kind: "translation" | "original") {
    if (!article) return;
    const value =
      kind === "translation" ? translationBody : originalText(article);
    if (!value) return;
    await navigator.clipboard.writeText(value);
    setCopied(kind);
    window.setTimeout(() => setCopied("none"), 1500);
  }

  const paragraphs = (body ?? "")
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  function isSpeaking(paragraph: number, sentenceIndex: number): boolean {
    return (
      speaking?.paragraph === paragraph &&
      speaking.sentenceIndex === sentenceIndex
    );
  }

  function onListen() {
    if (!menu) return;
    const { paragraph, sentenceIndex, sentence } = menu;
    if (isSpeaking(paragraph, sentenceIndex)) {
      speechRun.current += 1;
      stopSpeaking();
      setSpeaking(null);
      setMenu(null);
      return;
    }
    if (!canSpeak()) {
      setHint("Text-to-speech is not available in this browser.");
      return;
    }
    const settings = loadSettings();
    const lang =
      view === "translation"
        ? speechLangFor(settings.targetLanguage)
        : ORIGINAL_LANG;
    speechRun.current += 1;
    const runId = speechRun.current;
    const started = speakSentence(sentence, lang, {
      onEnd: () => {
        if (speechRun.current === runId) setSpeaking(null);
      },
      onError: (reason) => {
        if (speechRun.current !== runId) return;
        setSpeaking(null);
        if (!isCancellation(reason)) {
          setHint("Could not play this sentence with the system voice.");
        }
      },
    });
    setMenu(null);
    if (started) setSpeaking({ paragraph, sentenceIndex });
  }

  async function onCopySentence() {
    if (!menu) return;
    const sentence = menu.sentence;
    setMenu(null);
    try {
      await navigator.clipboard.writeText(sentence);
      setHint("Copied. Tap the Google Translate bubble to open it there.");
    } catch {
      setHint("Could not copy the sentence.");
    }
  }

  function switchView(next: "translation" | "original") {
    if (next === view) return;
    // Speech indexes the old text; stop it when the visible text changes.
    speechRun.current += 1;
    stopSpeaking();
    setSpeaking(null);
    setMenu(null);
    setView(next);
  }

  const finishedTimings = formatPhaseTimings({
    cleanDurationMs: article.cleanDurationMs,
    translateDurationMs: article.translateDurationMs,
  });

  return (
    <article className="article">
      <h1>{article.title}</h1>
      <p className="article-meta">
        {article.site ?? "manual"} · {formatDateTime(article.createdAt)} · via{" "}
        {article.via}
        {article.model ? ` · translated with ${article.model}` : ""}
        {article.url && (
          <>
            {" · "}
            <a href={article.url} target="_blank" rel="noreferrer">
              source
            </a>
          </>
        )}
      </p>
      <div className="actions">
        {!working && (
          <>
            <button type="button" onClick={toggleRead}>
              Mark {article.status === "read" ? "unread" : "read"}
            </button>
            <button type="button" onClick={toggleArchive}>
              {article.status === "archived" ? "Unarchive" : "Archive"}
            </button>
          </>
        )}
        <Link className="button" to={`/add?edit=${article.id}`}>
          Edit text
        </Link>
        {working ? (
          <button type="button" className="danger" onClick={onCancel}>
            Cancel
          </button>
        ) : (
          <button type="button" onClick={onRetranslate}>
            {article.translationStatus === "done"
              ? "Re-translate"
              : article.translationStatus === "error" ||
                  (article.translation && article.translatedChunks > 0)
                ? "Resume translation"
                : "Translate"}
          </button>
        )}
        <button type="button" className="danger" onClick={onDelete}>
          Delete
        </button>
      </div>
      {article.translationStatus === "running" && (
        <p className="muted pulse">
          {[
            article.translationPhase === "translating" &&
            article.cleanDurationMs != null
              ? `Cleaned in ${formatDurationMs(article.cleanDurationMs)}`
              : null,
            article.translationPhase === "cleaning"
              ? article.totalChunks > 0
                ? `Cleaning up the text… ${article.translatedChunks}/${article.totalChunks}`
                : "Cleaning up the text…"
              : `Translating… ${article.translatedChunks}/${article.totalChunks || "?"}`,
            article.phaseStartedAt != null
              ? formatDurationMs(now - article.phaseStartedAt)
              : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}
      {article.translationStatus !== "running" && finishedTimings && (
        <p className="muted">{finishedTimings}</p>
      )}
      {article.translationStatus === "error" && article.error && (
        <p className="error">{article.error}</p>
      )}
      <div className="toggle">
        <button
          type="button"
          className={view === "translation" ? "active" : ""}
          onClick={() => switchView("translation")}
        >
          Translation
        </button>
        <button
          type="button"
          className={view === "original" ? "active" : ""}
          onClick={() => switchView("original")}
        >
          Original
        </button>
      </div>
      <div className="actions">
        <button
          type="button"
          onClick={() => copy("translation")}
          disabled={!translationBody}
        >
          {copied === "translation" ? "Copied!" : "Copy translation"}
        </button>
        <button type="button" onClick={() => copy("original")}>
          {copied === "original" ? "Copied!" : "Copy original"}
        </button>
      </div>
      {body ? (
        <div className="article-text">
          {paragraphs.map((paragraph, paragraphIndex) => {
            const sentences = splitSentences(paragraph);
            const first = sentences[0]
              ? splitLeadingNumber(sentences[0])
              : null;
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
                      setMenu({
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
      ) : (
        <p className="muted">No translation yet.</p>
      )}
      {!working && (
        <div className="article-end">
          <button
            type="button"
            className={article.status === "read" ? "" : "primary"}
            onClick={toggleRead}
          >
            {article.status === "read" ? "Mark as unread" : "Mark as read"}
          </button>
        </div>
      )}
      {menu && (
        <>
          {/* biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: backdrop tap closes the sheet; Escape is handled globally */}
          <div
            className="sheet-backdrop"
            onClick={(event) => {
              if (event.target === event.currentTarget) setMenu(null);
            }}
          >
            <div
              className="sheet"
              role="dialog"
              aria-modal="true"
              aria-label="Sentence actions"
            >
              <p className="sheet-sentence">{menu.sentence}</p>
              <div className="sheet-actions">
                <button type="button" className="primary" onClick={onListen}>
                  {isSpeaking(menu.paragraph, menu.sentenceIndex)
                    ? "Stop"
                    : "Listen"}
                </button>
                <button type="button" onClick={onCopySentence}>
                  Copy
                </button>
              </div>
            </div>
          </div>
        </>
      )}
      {hint && <p className="toast">{hint}</p>}
    </article>
  );
}
