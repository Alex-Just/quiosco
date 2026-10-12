import { useEffect, useRef } from "react";
import type { ArticleStore } from "./store";
import type { ArticleView } from "./types";
import { clampZenIndex } from "./zenMode";

const SAVE_DEBOUNCE_MS = 200;

async function writeZenIndex(
  store: ArticleStore,
  articleId: string,
  view: ArticleView,
  zenIndex: number,
): Promise<void> {
  const existing = await store.getScrollPosition(articleId);
  await store.setScrollPosition(
    articleId,
    existing?.y ?? 0,
    existing?.view ?? view,
    zenIndex,
  );
}

/**
 * Loads the saved Zen paragraph index once content is ready, then writes it
 * back on change / hide / leave. `zenIndex === null` means restore is pending;
 * nothing is written until restore finishes.
 */
export function useZenPosition(args: {
  store: ArticleStore | null;
  articleId: string | undefined;
  /** Paragraph count for the article that matches articleId (0 if not ready). */
  totalParagraphs: number;
  view: ArticleView;
  zenIndex: number | null;
  onRestored: (index: number) => void;
}): void {
  const { store, articleId, totalParagraphs, view, zenIndex, onRestored } =
    args;
  const viewRef = useRef(view);
  viewRef.current = view;
  const zenIndexRef = useRef(zenIndex);
  zenIndexRef.current = zenIndex;
  const restoredForId = useRef<string | null>(null);

  useEffect(() => {
    if (!articleId) {
      restoredForId.current = null;
      return;
    }
    if (restoredForId.current !== articleId) {
      restoredForId.current = null;
    }
  }, [articleId]);

  useEffect(() => {
    if (!store || !articleId || totalParagraphs <= 0) return;
    if (restoredForId.current === articleId) return;
    let cancelled = false;
    void (async () => {
      const saved = await store.getScrollPosition(articleId);
      if (cancelled) return;
      restoredForId.current = articleId;
      const index =
        saved?.zenIndex != null
          ? clampZenIndex(saved.zenIndex, totalParagraphs)
          : 0;
      onRestored(index);
    })();
    return () => {
      cancelled = true;
    };
  }, [store, articleId, totalParagraphs, onRestored]);

  useEffect(() => {
    if (!store || !articleId || zenIndex == null) return;
    const timer = window.setTimeout(() => {
      void writeZenIndex(store, articleId, viewRef.current, zenIndex);
    }, SAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [store, articleId, zenIndex]);

  useEffect(() => {
    if (!store || !articleId) return;
    const flush = () => {
      const index = zenIndexRef.current;
      if (index == null) return;
      void writeZenIndex(store, articleId, viewRef.current, index);
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibility);
      flush();
    };
  }, [store, articleId]);
}
