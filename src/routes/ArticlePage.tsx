import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { formatDateTime } from "../lib/format";
import { splitSentences } from "../lib/sentences";
import { loadSettings } from "../lib/settings";
import {
  canSpeak,
  ORIGINAL_LANG,
  speakSentence,
  speechLangFor,
  stopSpeaking,
} from "../lib/speech";
import { cancelTranslation, translateArticle } from "../lib/translateArticle";
import type { Article } from "../lib/types";
import { useStore } from "../lib/useStore";

const STALE_RUN_MS = 10 * 60_000;

export default function ArticlePage() {
  const store = useStore();
  const navigate = useNavigate();
  const { id } = useParams();
  const [article, setArticle] = useState<Article | null>(null);
  const [view, setView] = useState<"original" | "translation">("translation");
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
  // Invalidates stale utterance callbacks: a replaced or cancelled utterance
  // may still fire end/error, and those must not clear the new highlight.
  const speechRun = useRef(0);

  useEffect(() => {
    if (!store || !id) return;
    let cancelled = false;
    void (async () => {
      const loaded = await store.get(id);
      if (!loaded || cancelled) return;
      setArticle(loaded);
      if (loaded.status === "unread") {
        const updated = await store.update(id, { status: "read" });
        if (!cancelled) setArticle(updated);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [store, id]);

  const running = article?.translationStatus === "running";
  useEffect(() => {
    if (!store || !id || !(running || busy)) return;
    const timer = window.setInterval(() => {
      void (async () => {
        const fresh = await store.get(id);
        if (!fresh) return;
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
  }, [store, id, running, busy]);

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
    if (article) cancelTranslation(article.id);
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

  // The streamed tail of the chunk in flight is shown (and copied) after the
  // committed chunks; it is replaced by the full chunk when it lands.
  const translationBody = [article.translation, article.partial]
    .filter((value): value is string => Boolean(value))
    .join("\n\n");

  async function copy(kind: "translation" | "original") {
    if (!article) return;
    const value = kind === "translation" ? translationBody : article.text;
    if (!value) return;
    await navigator.clipboard.writeText(value);
    setCopied(kind);
    window.setTimeout(() => setCopied("none"), 1500);
  }

  const body = view === "translation" ? translationBody : article.text;
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
      onError: () => {
        if (speechRun.current !== runId) return;
        setSpeaking(null);
        setHint("No system voice is available for this language.");
      },
    });
    setMenu(null);
    if (started) setSpeaking({ paragraph, sentenceIndex });
  }

  async function onTranslateSentence() {
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
        <button type="button" onClick={toggleRead}>
          Mark {article.status === "read" ? "unread" : "read"}
        </button>
        <button type="button" onClick={toggleArchive}>
          {article.status === "archived" ? "Unarchive" : "Archive"}
        </button>
        <Link className="button" to={`/add?edit=${article.id}`}>
          Edit text
        </Link>
        {running || busy ? (
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
          {article.translationPhase === "cleaning"
            ? "Cleaning up the text…"
            : `Translating… ${article.translatedChunks}/${article.totalChunks || "?"}`}
        </p>
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
        <>
          <p className="muted">Tap a sentence to listen or translate it.</p>
          <div className="article-text">
            {paragraphs.map((paragraph, paragraphIndex) => {
              const sentences = splitSentences(paragraph);
              return (
                // biome-ignore lint/suspicious/noArrayIndexKey: sentences have no stable id
                <p className="para" key={paragraphIndex}>
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
                          sentence,
                        })
                      }
                    >
                      {sentence}
                      {sentenceIndex < sentences.length - 1 ? " " : ""}
                    </button>
                  ))}
                </p>
              );
            })}
          </div>
        </>
      ) : (
        <p className="muted">No translation yet.</p>
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
                <button type="button" onClick={onTranslateSentence}>
                  Translate
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
