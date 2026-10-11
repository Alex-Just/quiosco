import { useEffect, useRef, useState } from "react";
import {
  Link,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import { createApi } from "../lib/api";
import {
  MAX_ARTICLE_CHARS,
  MIN_ARTICLE_TEXT_CHARS,
  newArticle,
} from "../lib/article";
import { cleanArticleText } from "../lib/clean";
import { LadderError } from "../lib/ladder";
import { preprocessUrlArticle } from "../lib/preprocessUrl";
import { loadSettings } from "../lib/settings";
import { shareBody } from "../lib/share";
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
  fromUrlShare?: boolean;
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
  const [cleanup, setCleanup] = useState(true);
  const [fetchDetail, setFetchDetail] = useState<string | null>(null);
  const [preprocessing, setPreprocessing] = useState(false);
  const [fetchedVia, setFetchedVia] = useState<Via | null>(null);
  // The prefill read is async; never overwrite what the user typed meanwhile.
  const edited = useRef(false);

  async function runPreprocess(targetUrl: string) {
    const settings = loadSettings();
    const canonical = normalizeUrl(targetUrl);
    if (!canonical) return;
    if (!settings.appToken) {
      setError(
        "Set your app token in Settings first — it is needed to fetch URLs.",
      );
      return;
    }
    setPreprocessing(true);
    setError(null);
    setCleanup(false);
    setFetchDetail("Fetching article…");
    try {
      const api = createApi({ token: settings.appToken });
      const result = await preprocessUrlArticle(canonical, api, {
        sharedTitle: title,
        onDetail: setFetchDetail,
      });
      if (!edited.current) {
        setText(result.text);
        setTitle((current) => current.trim() || result.title);
      }
      setFetchedVia(result.via);
      if (!edited.current) setCleanup(result.needsCleanup);
    } catch (preprocessError) {
      setError(
        preprocessError instanceof LadderError
          ? "Could not extract the article from that URL — paste the text instead, or try again."
          : preprocessError instanceof Error
            ? preprocessError.message
            : "Fetch failed. Check your token and try again.",
      );
      setFetchedVia(null);
    } finally {
      setPreprocessing(false);
      setFetchDetail(null);
    }
  }

  useEffect(() => {
    if (!store) return;
    let cancelled = false;
    void (async () => {
      let nextUrl = "";
      let nextText = "";
      let nextTitle = "";
      // The body a share actually carries: a URL-only share may repeat the URL
      // (or just the page title) in the text field, which is not article text.
      let nextBody = "";
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
        nextUrl = state?.prefillUrl ?? payload?.url ?? "";
        nextText = state?.prefillText ?? payload?.text ?? "";
        nextTitle = state?.prefillTitle ?? payload?.title ?? "";
        // A URL-only share often repeats the URL (or the page title) in the
        // text field. That is not article text: trusting it would skip the
        // fetch and save the URL as the body.
        nextBody = shareBody({
          text: nextText,
          title: nextTitle,
          url: nextUrl,
        });
        if (!cancelled && !edited.current) {
          setTitle(nextTitle);
          setUrl(nextUrl);
          setText(nextBody);
          if (state?.fromUrlShare) setCleanup(false);
        }
      }
      if (cancelled || editId || edited.current) {
        return;
      }
      const canonical = normalizeUrl(nextUrl);
      if (!canonical || nextBody.trim().length >= MIN_ARTICLE_TEXT_CHARS) {
        return;
      }
      const settings = loadSettings();
      if (!settings.appToken) {
        setError(
          "Set your app token in Settings first — it is needed to fetch URLs.",
        );
        return;
      }
      setPreprocessing(true);
      setError(null);
      setCleanup(false);
      setFetchDetail("Fetching article…");
      try {
        const api = createApi({ token: settings.appToken });
        const result = await preprocessUrlArticle(canonical, api, {
          sharedTitle: nextTitle,
          onDetail: setFetchDetail,
        });
        if (!cancelled && !edited.current) {
          setText(result.text);
          setTitle((current) => current.trim() || result.title);
          setCleanup(result.needsCleanup);
        }
        if (!cancelled) setFetchedVia(result.via);
      } catch (preprocessError) {
        if (!cancelled) {
          setError(
            preprocessError instanceof LadderError
              ? "Could not extract the article from that URL — paste the text instead, or try again."
              : preprocessError instanceof Error
                ? preprocessError.message
                : "Fetch failed. Check your token and try again.",
          );
          setFetchedVia(null);
        }
      } finally {
        if (!cancelled) {
          setPreprocessing(false);
          setFetchDetail(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [store, editId, location.state]);

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
      let via: Via = fetchedVia ?? "manual";
      let cleanupChoice = cleanup;
      if (
        !editId &&
        source.trim().length < MIN_ARTICLE_TEXT_CHARS &&
        canonical
      ) {
        if (!settings.appToken) {
          setError(
            "Set your app token in Settings first — it is needed to fetch URLs.",
          );
          return;
        }
        const api = createApi({ token: settings.appToken });
        const result = await preprocessUrlArticle(canonical, api, {
          sharedTitle: title,
          onDetail: setFetchDetail,
        });
        source = result.text;
        extractedTitle = result.title;
        via = result.via;
        cleanupChoice = result.needsCleanup;
        setCleanup(cleanupChoice);
        setText(source);
        setFetchedVia(via);
      }
      const cleaned =
        cleanupChoice && via === "manual"
          ? cleanArticleText(source, title)
          : source.trim();
      if (cleaned.length < MIN_ARTICLE_TEXT_CHARS) {
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
          !existing || (existing.cleanup !== false) !== cleanupChoice;
        await store.update(editId, {
          title: finalTitle || "Untitled",
          url: normalizeUrl(url),
          text: clipped,
          cleanup: cleanupChoice,
          ...(textChanged || cleanupChanged
            ? {
                translation: null,
                partial: null,
                translationStatus: "pending" as const,
                translatedChunks: 0,
                totalChunks: 0,
                cleanText: null,
                translationPhase: null,
                phaseStartedAt: null,
                cleanDurationMs: null,
                translateDurationMs: null,
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
        cleanup: cleanupChoice,
      });
      await store.put(article);
      if (settings.autoTranslate && settings.appToken) {
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

  const saveDisabled = busy || preprocessing;

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
          disabled={preprocessing}
        />
        Clean up the text before translating
      </label>
      <p className="muted">
        When enabled, menus, cookie banners, footers and link lists are removed
        from the text before it is translated.
      </p>
      {(preprocessing || fetchDetail) && (
        <p className="muted">{fetchDetail ?? "Preparing…"}</p>
      )}
      {error && <p className="error">{error}</p>}
      <div className="row form-actions">
        <button
          type="button"
          className="primary"
          onClick={onSave}
          disabled={saveDisabled}
        >
          {busy
            ? fetchDetail
              ? "Fetching…"
              : "Saving…"
            : preprocessing
              ? "Preparing…"
              : editId
                ? "Save"
                : "Save & translate"}
        </button>
        {error && !preprocessing && !editId && normalizeUrl(url) && (
          <button
            type="button"
            onClick={() => {
              void runPreprocess(url);
            }}
          >
            Try again
          </button>
        )}
        <Link className="button" to="/">
          Cancel
        </Link>
      </div>
    </section>
  );
}
