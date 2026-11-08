import { useCallback, useEffect, useMemo, useState } from "react";
import { createApi } from "./api";
import type { BookSentenceUnit } from "./bookText";
import {
  type KosyncDismissal,
  type KosyncPrompt,
  loadKosyncDismissal,
  saveKosyncDismissal,
  shouldPromptKosync,
  unitOffsets,
} from "./kosync";
import type { Article, KosyncProgress } from "./types";

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function browserStorage(): StorageLike | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export interface KosyncPromptController {
  prompt: KosyncPrompt | null;
  jump: () => void;
  dismiss: () => void;
}

/**
 * Read-only KOReader progress: fetch the last position pushed for this book
 * and offer a forward jump. Never writes a position back, because KOReader's
 * EPUB position is a CRe XPointer quiosco cannot produce.
 *
 * One lookup per book open. A dismissal is remembered per book and per
 * remote push, so the same position is not offered twice but a newer push is.
 */
export function useKosyncPrompt(args: {
  article: Article;
  units: readonly BookSentenceUnit[];
  /** Current Zen sentence index; null until the saved position is restored. */
  localIndex: number | null;
  appToken: string;
  /** Zen only: the prompt is part of the sentence reader. */
  enabled: boolean;
  onJump: (index: number) => void;
}): KosyncPromptController {
  const { article, units, localIndex, appToken, enabled, onJump } = args;
  const [remote, setRemote] = useState<KosyncProgress | null>(null);
  const [dismissed, setDismissed] = useState<KosyncDismissal | null>(null);

  const offsets = useMemo(() => unitOffsets(units), [units]);
  const ready = localIndex !== null && units.length > 0;

  useEffect(() => {
    const storage = browserStorage();
    setRemote(null);
    setDismissed(storage ? loadKosyncDismissal(storage, article.id) : null);
  }, [article.id]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new book must refetch even when its metadata matches
  useEffect(() => {
    if (!enabled || !appToken || !ready) return;
    const controller = new AbortController();
    const api = createApi({ token: appToken });
    void api
      .kosyncProgress(
        {
          filename: article.sourceFilename,
          title: article.title,
          author: article.author,
        },
        controller.signal,
      )
      .then((row) => {
        if (!controller.signal.aborted) setRemote(row);
      })
      .catch(() => {
        // A missing bridge, a bad token, or an offline device just means no
        // prompt; opening the book must never fail because of this lookup.
      });
    return () => controller.abort();
  }, [
    enabled,
    appToken,
    ready,
    article.id,
    article.sourceFilename,
    article.title,
    article.author,
  ]);

  const prompt = useMemo(() => {
    if (!enabled || localIndex === null) return null;
    return shouldPromptKosync({
      remote,
      offsets,
      localIndex,
      dismissed,
    });
  }, [enabled, localIndex, remote, offsets, dismissed]);

  const remember = useCallback(
    (value: KosyncPrompt) => {
      const dismissal = {
        document: value.document,
        updatedAt: value.updatedAt,
      };
      const storage = browserStorage();
      if (storage) saveKosyncDismissal(storage, article.id, dismissal);
      setDismissed(dismissal);
    },
    [article.id],
  );

  const jump = useCallback(() => {
    if (!prompt) return;
    remember(prompt);
    setRemote(null);
    onJump(prompt.index);
  }, [prompt, remember, onJump]);

  const dismiss = useCallback(() => {
    if (!prompt) return;
    remember(prompt);
    setRemote(null);
  }, [prompt, remember]);

  return { prompt, jump, dismiss };
}
