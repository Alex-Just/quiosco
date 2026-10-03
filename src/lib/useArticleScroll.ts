import { useEffect, useRef } from "react";
import type { ArticleStore } from "./store";
import type { ArticleView } from "./types";

// Positions are written at most this often while scrolling; the final position
// is also written when the page is hidden or left, so a kill loses at most a
// moment of scrolling.
const SAVE_THROTTLE_MS = 500;

/**
 * Restores and persists the reading position (scroll offset + view) of the
 * current article. Restores once per mount, after the content is on screen;
 * saves are throttled during scroll and flushed on hide/unmount.
 */
export function useArticleScroll(
  store: ArticleStore | null,
  articleId: string | undefined,
  ready: boolean,
  view: ArticleView,
  onRestoreView: (view: ArticleView) => void,
): void {
  const restored = useRef(false);
  const lastArticleId = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!store || !articleId) return;
    // A different article gets its own restore.
    if (lastArticleId.current !== articleId) {
      lastArticleId.current = articleId;
      restored.current = false;
    }
    if (restored.current) return;
    void (async () => {
      const saved = await store.getScrollPosition(articleId);
      if (!saved) {
        restored.current = true;
        return;
      }
      if (saved.view !== view) {
        // The position belongs to the other view; restore it first and let
        // this effect run again once that view is on screen.
        onRestoreView(saved.view);
        return;
      }
      if (!ready) return; // wait for the content to render
      restored.current = true;
      if (window.scrollY > 0) return;
      requestAnimationFrame(() => window.scrollTo(0, saved.y));
    })();
  }, [store, articleId, ready, view, onRestoreView]);

  useEffect(() => {
    if (!store || !articleId || !ready) return;
    let lastSave = 0;
    const save = () => {
      lastSave = Date.now();
      void store.setScrollPosition(articleId, Math.round(window.scrollY), view);
    };
    const onScroll = () => {
      if (Date.now() - lastSave < SAVE_THROTTLE_MS) return;
      save();
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") save();
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pagehide", save);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("pagehide", save);
      document.removeEventListener("visibilitychange", onVisibility);
      save();
    };
  }, [store, articleId, ready, view]);
}
