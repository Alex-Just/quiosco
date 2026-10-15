import { useEffect } from "react";
import type { Location } from "react-router-dom";
import {
  applySharePrefillFields,
  loadEditPrefill,
  loadSharePrefill,
  type PrefillHandlers,
  preprocessShortShareIfNeeded,
} from "./addPagePrefill";
import type { ArticleStore } from "./store";
import type { Via } from "./types";

export function useAddPagePrefill(options: {
  store: ArticleStore | null;
  editId: string | null;
  locationState: Location["state"];
  edited: { current: boolean };
  setTitle: (value: string | ((current: string) => string)) => void;
  setUrl: (url: string) => void;
  setText: (text: string) => void;
  setCleanup: (cleanup: boolean) => void;
  setError: (message: string | null) => void;
  setPreprocessing: (busy: boolean) => void;
  setFetchDetail: (detail: string | null) => void;
  setFetchWarning: (message: string | null) => void;
  setFetchedVia: (via: Via | null) => void;
}): void {
  const {
    store,
    editId,
    locationState,
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
  } = options;

  useEffect(() => {
    if (!store) return;
    let cancelled = false;
    const live = () => !cancelled;
    const handlers: PrefillHandlers = {
      setTitle,
      setUrl,
      setText,
      setCleanup,
      setError,
      setPreprocessing,
      setFetchDetail,
      setFetchWarning,
      setFetchedVia,
    };
    void (async () => {
      if (editId) {
        const article = await loadEditPrefill(store, editId);
        if (live() && article) {
          setTitle(article.title);
          setUrl(article.url);
          setText(article.text);
          setCleanup(article.cleanup);
        }
        return;
      }
      const share = await loadSharePrefill(locationState);
      if (live()) applySharePrefillFields(share, edited, handlers);
      await preprocessShortShareIfNeeded({
        share,
        edited,
        live,
        handlers,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [
    store,
    editId,
    locationState,
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
  ]);
}
