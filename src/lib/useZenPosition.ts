import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { ArticleStore } from "./store";
import type { ArticleView } from "./types";
import { clampZenIndex } from "./zenMode";

const SAVE_THROTTLE_MS = 300;

/**
 * Restores and persists the Zen paragraph index with the article's local
 * reading-position row (same store as scroll offset).
 */
export function useZenPosition(
  store: ArticleStore | null,
  articleId: string | undefined,
  ready: boolean,
  view: ArticleView,
  zenIndex: number,
  totalParagraphs: number,
  onRestoreIndex: (index: number) => void,
): void {
  const [hydrated, setHydrated] = useState(false);
  const markHydrated = useCallback(() => setHydrated(true), []);

  useEffect(() => {
    // Reset before restore when the open article changes.
    if (articleId !== undefined) setHydrated(false);
    else setHydrated(false);
  }, [articleId]);

  useZenRestore(
    store,
    articleId,
    ready,
    totalParagraphs,
    onRestoreIndex,
    markHydrated,
  );
  useZenPersist(store, articleId, ready && hydrated, view, zenIndex);
}

function useZenRestore(
  store: ArticleStore | null,
  articleId: string | undefined,
  ready: boolean,
  totalParagraphs: number,
  onRestoreIndex: (index: number) => void,
  markHydrated: () => void,
): void {
  const restored = useRef(false);
  const lastArticleId = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!store || !articleId) return;
    if (lastArticleId.current !== articleId) {
      lastArticleId.current = articleId;
      restored.current = false;
    }
    if (restored.current || !ready || totalParagraphs <= 0) return;
    let cancelled = false;
    void (async () => {
      const saved = await store.getScrollPosition(articleId);
      if (cancelled) return;
      restored.current = true;
      if (saved?.zenIndex != null) {
        onRestoreIndex(clampZenIndex(saved.zenIndex, totalParagraphs));
      }
      markHydrated();
    })();
    return () => {
      cancelled = true;
    };
  }, [store, articleId, ready, totalParagraphs, onRestoreIndex, markHydrated]);
}

function useZenPersist(
  store: ArticleStore | null,
  articleId: string | undefined,
  ready: boolean,
  view: ArticleView,
  zenIndex: number,
): void {
  const zenIndexRef = useRef(zenIndex);
  zenIndexRef.current = zenIndex;

  useLayoutEffect(() => {
    if (!store || !articleId || !ready) return;
    const save = () => {
      void (async () => {
        const existing = await store.getScrollPosition(articleId);
        await store.setScrollPosition(
          articleId,
          existing?.y ?? 0,
          existing?.view ?? view,
          zenIndexRef.current,
        );
      })();
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") save();
    };
    window.addEventListener("pagehide", save);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", save);
      document.removeEventListener("visibilitychange", onVisibility);
      save();
    };
  }, [store, articleId, ready, view]);

  useEffect(() => {
    if (!store || !articleId || !ready) return;
    const timer = window.setTimeout(() => {
      void (async () => {
        const existing = await store.getScrollPosition(articleId);
        await store.setScrollPosition(
          articleId,
          existing?.y ?? 0,
          existing?.view ?? view,
          zenIndex,
        );
      })();
    }, SAVE_THROTTLE_MS);
    return () => window.clearTimeout(timer);
  }, [store, articleId, ready, view, zenIndex]);
}
