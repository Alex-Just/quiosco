import { useEffect, useRef, useState } from "react";
import {
  Link,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import { AddBookForm } from "../components/AddBookForm";
import { saveErrorMessage, TOKEN_REQUIRED_FOR_URL } from "../lib/addPageErrors";
import { addPageSaveLabel, showAddPageTryAgain } from "../lib/addPageUi";
import { runAddPagePreprocess } from "../lib/runAddPagePreprocess";
import { saveAddPageArticle } from "../lib/saveAddPageArticle";
import { clearPendingBook, readPendingBook } from "../lib/sharePayload";
import { translateArticle } from "../lib/translateArticle";
import type { Via } from "../lib/types";
import { useAddPagePrefill } from "../lib/useAddPagePrefill";
import { useStore } from "../lib/useStore";

export default function AddPage() {
  const store = useStore();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const editId = params.get("edit");

  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  // A shared EPUB arrives through /share with this state flag: open Book mode
  // and hand the file to the form, which parses it exactly like a picked one.
  const fromBookShare =
    (location.state as { fromBookShare?: boolean } | null)?.fromBookShare ===
    true;
  const [sharedBook, setSharedBook] = useState<File | null>(null);
  const [mode, setMode] = useState<"article" | "book">(
    fromBookShare ? "book" : "article",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cleanup, setCleanup] = useState(true);
  const [fetchDetail, setFetchDetail] = useState<string | null>(null);
  const [fetchWarning, setFetchWarning] = useState<string | null>(null);
  const [preprocessing, setPreprocessing] = useState(false);
  const [fetchedVia, setFetchedVia] = useState<Via | null>(null);
  // The prefill read is async; never overwrite what the user typed meanwhile.
  const edited = useRef(false);

  useAddPagePrefill({
    store,
    editId,
    locationState: location.state,
    edited,
    setTitle,
    setUrl,
    setText,
    setCleanup,
    setError,
    setPreprocessing,
    setFetchDetail,
    setFetchWarning,
    setFetchedVia,
  });

  useEffect(() => {
    if (!fromBookShare) return;
    let cancelled = false;
    void (async () => {
      const file = await readPendingBook();
      if (cancelled || !file) return;
      setSharedBook(file);
      // Consumed into the form; an abandoned preview can be re-shared.
      await clearPendingBook();
    })();
    return () => {
      cancelled = true;
    };
  }, [fromBookShare]);

  const preprocessApply = {
    setText,
    setTitle,
    setFetchedVia,
    setCleanup,
    setError,
    setPreprocessing,
    setFetchDetail,
    setFetchWarning,
  };

  async function onTryAgain() {
    await runAddPagePreprocess({
      targetUrl: url,
      sharedTitle: title,
      edited,
      apply: preprocessApply,
    });
  }

  async function onSave() {
    if (!store) return;
    setBusy(true);
    setError(null);
    setFetchDetail(null);
    setFetchWarning(null);
    try {
      const result = await saveAddPageArticle({
        store,
        editId,
        title,
        url,
        text,
        cleanup,
        fetchedVia,
        onFetchDetail: setFetchDetail,
        onPreprocessApplied: ({
          text: nextText,
          cleanup: nextCleanup,
          via,
        }) => {
          setCleanup(nextCleanup);
          setText(nextText);
          setFetchedVia(via);
        },
      });
      if (result.kind === "duplicate") {
        navigate(`/article/${result.articleId}`, { replace: true });
        return;
      }
      if (result.kind === "needs-token") {
        setError(TOKEN_REQUIRED_FOR_URL);
        return;
      }
      if (result.kind === "validation") {
        setError(result.message);
        return;
      }
      navigate(`/article/${result.articleId}`, { replace: true });
      if (result.startTranslation) {
        const { article, settings } = result.startTranslation;
        void translateArticle(store, article, settings);
      }
    } catch (saveError) {
      setError(saveErrorMessage(saveError));
    } finally {
      setBusy(false);
      setFetchDetail(null);
      setFetchWarning(null);
    }
  }

  const saveDisabled = busy || preprocessing;
  const saveLabel = addPageSaveLabel({
    busy,
    fetchDetail,
    preprocessing,
    editId,
  });
  const tryAgainVisible = showAddPageTryAgain({
    error,
    preprocessing,
    editId,
    url,
  });
  // Editing an existing row is always article mode; books are not editable here.
  const activeMode = editId ? "article" : mode;
  const pageTitle = editId
    ? "Edit article"
    : activeMode === "book"
      ? "Add book"
      : "Add article";

  return (
    <section className="add">
      <h1>{pageTitle}</h1>
      {!editId && (
        <div className="tabs" role="tablist" aria-label="Type">
          <button
            type="button"
            role="tab"
            aria-selected={activeMode === "article"}
            className={activeMode === "article" ? "tab active" : "tab"}
            onClick={() => setMode("article")}
          >
            Article
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeMode === "book"}
            className={activeMode === "book" ? "tab active" : "tab"}
            onClick={() => setMode("book")}
          >
            Book
          </button>
        </div>
      )}
      {activeMode === "book" && store && (
        <AddBookForm
          store={store}
          sharedFile={sharedBook}
          onSharedConsumed={() => setSharedBook(null)}
          onSaved={(id) => navigate(`/article/${id}`, { replace: true })}
        />
      )}
      {activeMode === "book" && !store && <p className="muted">Loading…</p>}
      {activeMode === "article" && (
        <>
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
            When enabled, menus, cookie banners, footers and link lists are
            removed from the text before it is translated.
          </p>
          {(preprocessing || fetchDetail) && (
            <p className="muted">{fetchDetail ?? "Preparing…"}</p>
          )}
          {error && <p className="error">{error}</p>}
          {fetchWarning && <p className="muted">{fetchWarning}</p>}
          <div className="row form-actions">
            <button
              type="button"
              className="primary"
              onClick={onSave}
              disabled={saveDisabled}
            >
              {saveLabel}
            </button>
            {tryAgainVisible && (
              <button type="button" onClick={() => void onTryAgain()}>
                Try again
              </button>
            )}
            <Link className="button" to="/">
              Cancel
            </Link>
          </div>
        </>
      )}
    </section>
  );
}
