import { type Dispatch, type SetStateAction, useEffect, useState } from "react";
import type { NavigateFunction } from "react-router-dom";
import { repairGarbageTitle } from "./repairGarbageTitle";
import type { ArticleStore } from "./store";
import { isStoreChangeForArticle, STORE_CHANGE_EVENT } from "./storeEvents";
import type { Article } from "./types";

export const STALE_RUN_MS = 10 * 60_000;
export const PHASE_TICK_MS = 1000;
/** Fallback lease check only; live partials arrive via STORE_CHANGE_EVENT. */
const STALE_POLL_MS = 1000;

async function loadArticleOrRedirect(
  store: ArticleStore,
  id: string,
  navigate: NavigateFunction,
): Promise<Article | null> {
  const loaded = await store.get(id);
  if (!loaded) {
    navigate("/", { replace: true });
    return null;
  }
  const repaired = repairGarbageTitle(loaded);
  if (!repaired) return loaded;
  return store.update(id, { title: repaired });
}

async function refreshRunningArticle(
  store: ArticleStore,
  id: string,
  navigate: NavigateFunction,
): Promise<Article | null> {
  const fresh = await store.get(id);
  if (!fresh) {
    navigate("/", { replace: true });
    return null;
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
    return store.update(id, {
      translationStatus: "error",
      error: "Translation was interrupted — resume to continue.",
    });
  }
  return fresh;
}

function useArticleInitialLoad(
  store: ArticleStore | null,
  id: string | undefined,
  navigate: NavigateFunction,
  setArticle: Dispatch<SetStateAction<Article | null>>,
): void {
  useEffect(() => {
    if (!store || !id) return;
    let cancelled = false;
    void (async () => {
      const loaded = await loadArticleOrRedirect(store, id, navigate);
      if (cancelled || !loaded) return;
      setArticle(loaded);
    })();
    return () => {
      cancelled = true;
    };
  }, [store, id, navigate, setArticle]);
}

function useArticleSyncReload(
  store: ArticleStore | null,
  id: string | undefined,
  navigate: NavigateFunction,
  setArticle: Dispatch<SetStateAction<Article | null>>,
): void {
  useEffect(() => {
    if (!store || !id) return;
    let requestId = 0;
    const reload = () => {
      requestId += 1;
      const myRequest = requestId;
      void (async () => {
        const fresh = await loadArticleOrRedirect(store, id, navigate);
        // Drop stale reads so a slow reload cannot overwrite a newer partial.
        if (myRequest !== requestId) return;
        if (fresh) setArticle(fresh);
      })();
    };
    const onStoreChange = (event: Event) => {
      if (isStoreChangeForArticle(event, id)) reload();
    };
    window.addEventListener("quiosco:sync", reload);
    window.addEventListener(STORE_CHANGE_EVENT, onStoreChange);
    return () => {
      window.removeEventListener("quiosco:sync", reload);
      window.removeEventListener(STORE_CHANGE_EVENT, onStoreChange);
    };
  }, [store, id, navigate, setArticle]);
}

function usePhaseClock(
  running: boolean,
  phaseStartedAt: number | null | undefined,
  setNow: Dispatch<SetStateAction<number>>,
): void {
  useEffect(() => {
    if (!running || phaseStartedAt == null) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), PHASE_TICK_MS);
    return () => window.clearInterval(timer);
  }, [running, phaseStartedAt, setNow]);
}

function useStaleRunningPoll(
  store: ArticleStore | null,
  id: string | undefined,
  running: boolean,
  navigate: NavigateFunction,
  setArticle: Dispatch<SetStateAction<Article | null>>,
): void {
  useEffect(() => {
    if (!store || !id || !running) return;
    const timer = window.setInterval(() => {
      void (async () => {
        const fresh = await refreshRunningArticle(store, id, navigate);
        if (fresh) setArticle(fresh);
      })();
    }, STALE_POLL_MS);
    return () => window.clearInterval(timer);
  }, [store, id, running, navigate, setArticle]);
}

export function useArticleDocument(
  store: ArticleStore | null,
  id: string | undefined,
  navigate: NavigateFunction,
): {
  article: Article | null;
  setArticle: Dispatch<SetStateAction<Article | null>>;
  now: number;
  running: boolean;
} {
  const [article, setArticle] = useState<Article | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const running = article?.translationStatus === "running";

  useArticleInitialLoad(store, id, navigate, setArticle);
  useArticleSyncReload(store, id, navigate, setArticle);
  usePhaseClock(running, article?.phaseStartedAt, setNow);
  useStaleRunningPoll(store, id, running, navigate, setArticle);

  return { article, setArticle, now, running };
}
