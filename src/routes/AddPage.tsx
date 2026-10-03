import { useEffect, useRef, useState } from "react";
import {
  Link,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import { createApi } from "../lib/api";
import { MAX_ARTICLE_CHARS, newArticle } from "../lib/article";
import { cleanArticleText } from "../lib/clean";
import { climbLadder, LadderError } from "../lib/ladder";
import { loadSettings } from "../lib/settings";
import { clearPendingShare, readPendingShare } from "../lib/sharePayload";
import { extractTitleWithLlm } from "../lib/titleWithLlm";
import { translateArticle } from "../lib/translateArticle";
import type { Via } from "../lib/types";
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
  const [cleanup, setCleanup] = useState(true);
  const [fetchDetail, setFetchDetail] = useState<string | null>(null);
  // The prefill read is async; never overwrite what the user typed meanwhile.
  const edited = useRef(false);

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
          setCleanup(article.cleanup !== false);
        }
      } else {
        const state = (location.state ?? null) as PrefillState | null;
        const payload = await readPendingShare();
        if (!cancelled && !edited.current) {
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
    setBusy(true);
    setError(null);
    setFetchDetail(null);
    try {
      const settings = loadSettings();
      const canonical = normalizeUrl(url);
      if (!editId && canonical) {
        const existing = await store.findByUrl(canonical);
        if (existing) {
          await clearPendingShare();
          navigate(`/article/${existing.id}`);
          return;
        }
      }
      let source = text;
      let extractedTitle: string | null = null;
      let via: Via = "manual";
      if (!editId && source.trim().length < 40 && canonical) {
        // No text pasted: fetch and extract the article from the URL, using
        // the same ladder as the Android share flow.
        if (!settings.appToken) {
          setError(
            "Set your app token in Settings first — it is needed to fetch URLs.",
          );
          return;
        }
        const api = createApi({ token: settings.appToken });
        const result = await climbLadder(canonical, async (rung, target) => {
          setFetchDetail(`Trying ${rung}…`);
          return api.fetchRung(rung, target);
        });
        source = result.article.text;
        extractedTitle = result.article.title;
        via = result.via;
      }
      const cleaned =
        cleanup && via === "manual"
          ? cleanArticleText(source, title)
          : source.trim();
      if (cleaned.length < 40) {
        setError(
          canonical
            ? "Could not read that URL. Paste the article text instead."
            : "Paste the article text first (at least a paragraph).",
        );
        return;
      }
      const clipped = cleaned.slice(0, MAX_ARTICLE_CHARS);
      let finalTitle = title.trim() || extractedTitle?.trim() || "";
      if (!finalTitle && settings.appToken) {
        const api = createApi({ token: settings.appToken });
        const guessed = await extractTitleWithLlm(
          clipped,
          settings.model,
          (request) => api.translate(request),
        );
        if (guessed) finalTitle = guessed;
      }
      if (editId) {
        const existing = await store.get(editId);
        const textChanged = !existing || existing.text !== clipped;
        const cleanupChanged =
          !existing || (existing.cleanup !== false) !== cleanup;
        await store.update(editId, {
          title: finalTitle || "Untitled",
          url: normalizeUrl(url),
          text: clipped,
          cleanup,
          // Editing the text or the cleanup choice invalidates any stored
          // translation.
          ...(textChanged || cleanupChanged
            ? {
                translation: null,
                partial: null,
                translationStatus: "pending" as const,
                translatedChunks: 0,
                totalChunks: 0,
                cleanText: null,
                translationPhase: null,
                error: null,
              }
            : {}),
        });
        await clearPendingShare();
        navigate(`/article/${editId}`);
        return;
      }
      const article = newArticle({
        url: canonical,
        title: finalTitle,
        text: clipped,
        via,
        cleanup,
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
      setError(
        saveError instanceof LadderError
          ? "Could not extract the article from that URL — paste the text instead."
          : saveError instanceof Error
            ? saveError.message
            : "save failed",
      );
    } finally {
      setBusy(false);
      setFetchDetail(null);
    }
  }

  return (
    <section className="add">
      <h1>{editId ? "Edit article" : "Add article"}</h1>
      <label>
        Title (optional — guessed from the text if left empty)
        <input
          value={title}
          onChange={(event) => {
            edited.current = true;
            setTitle(event.target.value);
          }}
        />
      </label>
      <label>
        Source URL (optional — fetched when no text is pasted)
        <input
          value={url}
          onChange={(event) => {
            edited.current = true;
            setUrl(event.target.value);
          }}
          inputMode="url"
        />
      </label>
      <label>
        Article text
        <textarea
          rows={7}
          value={text}
          onChange={(event) => {
            edited.current = true;
            setText(event.target.value);
          }}
        />
      </label>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={cleanup}
          onChange={(event) => setCleanup(event.target.checked)}
        />
        Clean up the text before translating
      </label>
      <p className="muted">
        When enabled, menus, cookie banners, footers and link lists are removed
        from the text before it is translated.
      </p>
      {fetchDetail && <p className="muted">{fetchDetail}</p>}
      {error && <p className="error">{error}</p>}
      <div className="row form-actions">
        <button
          type="button"
          className="primary"
          onClick={onSave}
          disabled={busy}
        >
          {busy
            ? fetchDetail
              ? "Fetching…"
              : "Saving…"
            : editId
              ? "Save"
              : "Save & translate"}
        </button>
        <Link className="button" to="/">
          Cancel
        </Link>
      </div>
    </section>
  );
}
