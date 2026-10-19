// Whole-book EPUB export: build the file from whatever the sentence cache
// holds right now, or finish translating the book first and export when the
// run completes. The finish run plans the same windows, keys and prompt the
// reader's prefetch uses, so every cached sentence is reused and the run
// resumes for free after a pause. One job at a time per book; the reader
// renders the status.
import { useEffect, useMemo, useRef, useState } from "react";
import { createApi } from "./api";
import {
  type BookFinishProgress,
  type BookFinishSession,
  type BookFinishStatus,
  startBookFinish,
} from "./bookFinish";
import type { BookSentenceUnit } from "./bookText";
import { downloadEpub, exportBookEpub } from "./epub/exportBook";
import { buildBookSystemPrompt } from "./prompt";
import { createSentenceKeyMemo } from "./sentenceKey";
import type { ArticleStore } from "./store";
import type { Article } from "./types";

export type BookExportUiStatus = "idle" | BookFinishStatus | "exporting";

export interface BookExportHook {
  uiStatus: BookExportUiStatus;
  progress: BookFinishProgress | null;
  startFinish(): void;
  cancelFinish(): void;
  exportNow(): void;
}

/**
 * Export state for one open book. `exportNow` builds and downloads from the
 * current cache; `startFinish` translates every missing sentence first and
 * exports automatically when it finishes. Dispose happens on unmount and
 * whenever the book changes.
 */
export function useBookExport(args: {
  store: ArticleStore;
  article: Article;
  settings: {
    appToken: string;
    targetLanguage: string;
    rules: string;
    model: string;
  };
  /** Flat-paragraph sentence units, computed once by the caller. */
  units: readonly BookSentenceUnit[];
  onExported: (filename: string) => void;
  onExportFailed: () => void;
}): BookExportHook {
  const { store, article, settings, units, onExported, onExportFailed } = args;
  const { appToken, targetLanguage, rules, model } = settings;
  const [uiStatus, setUiStatus] = useState<BookExportUiStatus>("idle");
  const [progress, setProgress] = useState<BookFinishProgress | null>(null);
  /** Mirror of uiStatus for the imperative callbacks and their async guards. */
  const uiStatusRef = useRef<BookExportUiStatus>("idle");
  const sessionRef = useRef<BookFinishSession | null>(null);
  /** Invalidates a start whose session does not exist yet (rules-hash lag). */
  const startGeneration = useRef(0);

  // Book metadata comes from the article; the settings that shape the prompt
  // are listed as deps so the finish run is rebuilt exactly when one changes.
  const system = useMemo(
    () =>
      buildBookSystemPrompt({
        title: article.title,
        author: article.author,
        sourceLanguage: article.bookLanguage,
        targetLanguage,
        rules,
      }),
    [
      article.title,
      article.author,
      article.bookLanguage,
      targetLanguage,
      rules,
    ],
  );

  const applyStatus = (next: BookExportUiStatus) => {
    uiStatusRef.current = next;
    setUiStatus(next);
  };

  const disposeSession = () => {
    sessionRef.current?.dispose();
    sessionRef.current = null;
  };

  // Read the cache and hand the file to the browser. A finish run that is
  // still working keeps its status: the export is a snapshot beside it.
  const runExport = async (): Promise<void> => {
    applyStatus("exporting");
    setProgress(null);
    try {
      const { bytes, filename } = await exportBookEpub({
        store,
        article,
        settings,
      });
      downloadEpub(bytes, filename);
      onExported(filename);
    } catch {
      onExportFailed();
    }
    const session = sessionRef.current;
    if (session !== null && session.status() === "working") {
      applyStatus("working");
      setProgress(session.progress());
    } else {
      applyStatus("idle");
    }
  };

  const startFinish = () => {
    if (!appToken) return;
    if (
      uiStatusRef.current === "working" ||
      uiStatusRef.current === "exporting"
    ) {
      return;
    }
    disposeSession();
    startGeneration.current += 1;
    const generation = startGeneration.current;
    applyStatus("working");
    setProgress({ done: 0, total: units.length });
    const keyMemo = createSentenceKeyMemo({ targetLanguage, rules });
    const api = createApi({ token: appToken });
    void keyMemo.rulesHash().then((rulesHashValue) => {
      if (generation !== startGeneration.current) return;
      const session = startBookFinish({
        deps: { store, translate: api.translate },
        units,
        keyFor: (unitIndex) => keyMemo.keyFor(units[unitIndex]?.text ?? ""),
        model,
        system,
        targetLanguage,
        rulesHashValue,
      });
      sessionRef.current = session;
      setProgress(session.progress());
      applyStatus(session.status());
      session.onUpdate(() => {
        if (session.status() === "done") {
          sessionRef.current = null;
          session.dispose();
          applyStatus("done");
          void runExport();
          return;
        }
        applyStatus(session.status());
        setProgress(session.progress());
      });
    });
  };

  const cancelFinish = () => {
    startGeneration.current += 1;
    disposeSession();
    applyStatus("idle");
    setProgress(null);
  };

  const exportNow = () => {
    if (uiStatusRef.current === "exporting") return;
    void runExport();
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: article.id is the identity that ends this book's run
  useEffect(() => {
    // One job per book: leaving this book (or unmounting) ends the run.
    return () => {
      startGeneration.current += 1;
      sessionRef.current?.dispose();
      sessionRef.current = null;
      uiStatusRef.current = "idle";
      setUiStatus("idle");
      setProgress(null);
    };
  }, [article.id]);

  return { uiStatus, progress, startFinish, cancelFinish, exportNow };
}
