import { useEffect, useState } from "react";
import {
  Link,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import { MAX_ARTICLE_CHARS, newArticle } from "../lib/article";
import { loadSettings } from "../lib/settings";
import { clearPendingShare, readPendingShare } from "../lib/sharePayload";
import { translateArticle } from "../lib/translateArticle";
import { normalizeUrl } from "../lib/url";
import { useStore } from "../lib/useStore";

interface PrefillState {
  prefillText?: string;
  prefillTitle?: string;
  prefillUrl?: string;
}

export default function AddPage() {
  const store = useStore();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const editId = params.get("edit");

  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!store || loaded) return;
    let cancelled = false;
    void (async () => {
      if (editId) {
        const article = await store.get(editId);
        if (!cancelled && article) {
          setTitle(article.title);
          setUrl(article.url ?? "");
          setText(article.text);
        }
      } else {
        const state = (location.state ?? null) as PrefillState | null;
        const payload = await readPendingShare();
        if (!cancelled) {
          setTitle(state?.prefillTitle ?? payload?.title ?? "");
          setUrl(state?.prefillUrl ?? payload?.url ?? "");
          setText(state?.prefillText ?? payload?.text ?? "");
        }
      }
      if (!cancelled) setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [store, loaded, editId, location.state]);

  async function onSave() {
    if (!store) return;
    const trimmed = text.trim();
    if (trimmed.length < 40) {
      setError("Paste the article text first (at least a paragraph).");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const settings = loadSettings();
      const clipped = trimmed.slice(0, MAX_ARTICLE_CHARS);
      if (editId) {
        const existing = await store.get(editId);
        const textChanged = !existing || existing.text !== clipped;
        await store.update(editId, {
          title: title.trim() || "Untitled",
          url: normalizeUrl(url),
          text: clipped,
          // Editing the text invalidates any stored translation.
          ...(textChanged
            ? {
                translation: null,
                translationStatus: "pending" as const,
                translatedChunks: 0,
                totalChunks: 0,
                error: null,
              }
            : {}),
        });
        await clearPendingShare();
        navigate(`/article/${editId}`);
        return;
      }
      const canonical = normalizeUrl(url);
      if (canonical) {
        const existing = await store.findByUrl(canonical);
        if (existing) {
          await clearPendingShare();
          navigate(`/article/${existing.id}`);
          return;
        }
      }
      const article = newArticle({
        url: canonical,
        title,
        text: clipped,
        via: "manual",
      });
      await store.put(article);
      if (settings.autoTranslate && settings.appToken) {
        // Mark the run before navigating so the article page can show progress
        // and cannot start a second concurrent translation.
        await store.update(article.id, { translationStatus: "running" });
      }
      await clearPendingShare();
      navigate(`/article/${article.id}`);
      if (settings.autoTranslate && settings.appToken) {
        void translateArticle(store, article, settings);
      }
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="add">
      <h1>{editId ? "Edit article" : "Add article"}</h1>
      <label>
        Title
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
      </label>
      <label>
        Source URL (optional)
        <input
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          inputMode="url"
        />
      </label>
      <label>
        Article text
        <textarea
          rows={12}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
      </label>
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button
          type="button"
          className="primary"
          onClick={onSave}
          disabled={busy}
        >
          {editId ? "Save" : "Save & translate"}
        </button>
        <Link className="button" to="/">
          Cancel
        </Link>
      </div>
    </section>
  );
}
