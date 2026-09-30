import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { loadSettings } from "../lib/settings";
import { translateArticle } from "../lib/translateArticle";
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

  async function onRetranslate() {
    if (!store || !article || busy) return;
    const settings = loadSettings();
    if (!settings.appToken) {
      navigate("/settings");
      return;
    }
    setBusy(true);
    try {
      const fresh = await store.update(article.id, {
        translationStatus: "pending",
        error: null,
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
    const value = kind === "translation" ? article.translation : article.text;
    if (!value) return;
    await navigator.clipboard.writeText(value);
    setCopied(kind);
    window.setTimeout(() => setCopied("none"), 1500);
  }

  const body = view === "translation" ? article.translation : article.text;

  return (
    <article className="article">
      <h1>{article.title}</h1>
      <p className="article-meta">
        {article.site ?? "manual"} ·{" "}
        {new Date(article.createdAt).toLocaleString()} · via {article.via}
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
        <button
          type="button"
          onClick={onRetranslate}
          disabled={busy || running}
        >
          {busy || running
            ? "Translating…"
            : article.translationStatus === "error" ||
                (article.translation && article.translatedChunks > 0)
              ? "Resume translation"
              : "Translate"}
        </button>
        <button type="button" className="danger" onClick={onDelete}>
          Delete
        </button>
      </div>
      {article.translationStatus === "running" && (
        <p className="muted">
          Translating… {article.translatedChunks}/{article.totalChunks || "?"}
        </p>
      )}
      {article.translationStatus === "error" && article.error && (
        <p className="error">{article.error}</p>
      )}
      <div className="toggle">
        <button
          type="button"
          className={view === "translation" ? "active" : ""}
          onClick={() => setView("translation")}
        >
          Translation
        </button>
        <button
          type="button"
          className={view === "original" ? "active" : ""}
          onClick={() => setView("original")}
        >
          Original
        </button>
      </div>
      <div className="actions">
        <button
          type="button"
          onClick={() => copy("translation")}
          disabled={!article.translation}
        >
          {copied === "translation" ? "Copied!" : "Copy translation"}
        </button>
        <button type="button" onClick={() => copy("original")}>
          {copied === "original" ? "Copied!" : "Copy original"}
        </button>
      </div>
      {body ? (
        <div className="article-text">{body}</div>
      ) : (
        <p className="muted">No translation yet.</p>
      )}
    </article>
  );
}
