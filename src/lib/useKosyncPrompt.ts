import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createApi } from "./api";
import type { BookSentenceUnit } from "./bookText";
import {
  bilingualXPointer,
  isBilingualExportFilename,
  KOSYNC_MAPPING_VERSION,
  type KosyncDismissal,
  type KosyncPrompt,
  loadKosyncDismissal,
  saveKosyncDismissal,
  shouldPromptKosync,
  unitOffsets,
  unitStartPercentage,
} from "./kosync";
import type { Article, KosyncProgress } from "./types";

type StorageLike = Pick<Storage, "getItem" | "setItem">;

/** Wait for a settled sentence before writing; page turns are rapid. */
const PUSH_DEBOUNCE_MS = 1_500;

/**
 * Per-book push state. Kept in one object so a new book can replace it while
 * an old in-flight queue still holds its own copy.
 */
interface PushState {
  /** Server timestamp last seen or written; null until the lookup resolves. */
  base: number | null;
  /** Terminal for the session: remote moved, unlinked, disabled, or not exact. */
  stalled: boolean;
  /** Last unit index the server accepted for this book. */
  lastPushed: number | null;
  /** Latest index waiting to be written. */
  pending: number | null;
  running: boolean;
}

function newPushState(): PushState {
  return {
    base: null,
    stalled: false,
    lastPushed: null,
    pending: null,
    running: false,
  };
}

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
 * KOReader progress bridge.
 *
 * Read: fetch the last position KOReader pushed for this book and offer a
 * jump. A quiosco `*-bilingual.epub` export inside KOReader maps exactly by
 * XPointer; other EPUBs fall back to the approximate percentage. One lookup
 * per book open. A dismissal is remembered per book, mapping generation, and
 * remote push, so the same position is not offered twice but a newer push or
 * a corrected mapping is.
 *
 * Write: for a bilingual export, push the local sentence back as the exact
 * XPointer KOReader understands. The server refuses every other file. Push is
 * debounced, gated on the lookup finishing and on no jump banner showing, and
 * guarded by the server timestamp the app last saw, so a newer e-reader
 * position is never overwritten. Every failure is silent; reading continues.
 */
export function useKosyncPrompt(args: {
  article: Article;
  units: readonly BookSentenceUnit[];
  /** Current Zen sentence index; null until the saved position is restored. */
  localIndex: number | null;
  /** First Zen unit of each chapter, including its title. */
  chapterUnitStarts: readonly number[];
  /** First body unit of each chapter (titles excluded). */
  chapterBodyStarts: readonly number[];
  appToken: string;
  /** Zen only: the prompt and push are part of the sentence reader. */
  enabled: boolean;
  onJump: (index: number) => void;
}): KosyncPromptController {
  const {
    article,
    units,
    localIndex,
    chapterUnitStarts,
    chapterBodyStarts,
    appToken,
    enabled,
    onJump,
  } = args;
  const [remote, setRemote] = useState<KosyncProgress | null>(null);
  const [dismissed, setDismissed] = useState<KosyncDismissal | null>(null);
  const [lookupDone, setLookupDone] = useState(false);

  const api = useMemo(
    () => (appToken ? createApi({ token: appToken }) : null),
    [appToken],
  );
  const pushRef = useRef<PushState>(newPushState());
  const latestIndexRef = useRef<number | null>(null);

  const offsets = useMemo(() => unitOffsets(units), [units]);
  const ready = localIndex !== null && units.length > 0;
  const pushable = useMemo(
    () =>
      isBilingualExportFilename(article.sourceFilename) &&
      chapterBodyStarts.length > 0 &&
      units.length > 0,
    [article.sourceFilename, chapterBodyStarts.length, units.length],
  );

  useEffect(() => {
    const storage = browserStorage();
    setRemote(null);
    setDismissed(storage ? loadKosyncDismissal(storage, article.id) : null);
    setLookupDone(false);
    pushRef.current = newPushState();
    latestIndexRef.current = null;
  }, [article.id]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new book must refetch even when its metadata matches
  useEffect(() => {
    if (!enabled || !api || !ready) return;
    const controller = new AbortController();
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
        if (controller.signal.aborted) return;
        setRemote(row);
        pushRef.current.base = row?.updatedAt ?? null;
        setLookupDone(true);
      })
      .catch(() => {
        // A missing bridge, a bad token, or an offline device just means no
        // prompt or push; opening the book must never fail because of this.
        if (!controller.signal.aborted) setLookupDone(true);
      });
    return () => controller.abort();
  }, [
    enabled,
    api,
    ready,
    article.id,
    article.sourceFilename,
    article.title,
    article.author,
  ]);

  useEffect(() => {
    if (localIndex !== null) latestIndexRef.current = localIndex;
  }, [localIndex]);

  const prompt = useMemo(() => {
    if (!enabled || localIndex === null) return null;
    return shouldPromptKosync({
      remote,
      offsets,
      localIndex,
      dismissed,
      chapterBodyStarts,
    });
  }, [enabled, localIndex, remote, offsets, dismissed, chapterBodyStarts]);

  const sendPosition = useCallback(
    async (state: PushState, index: number) => {
      if (!api || !pushable || state.base === null || state.stalled) return;
      if (state.lastPushed === index) return;
      const filename = article.sourceFilename;
      if (!filename) return;
      const progress = bilingualXPointer({
        index,
        chapterUnitStarts,
        chapterBodyStarts,
        unitCount: units.length,
      });
      if (!progress) return;
      try {
        const result = await api.kosyncPush({
          filename,
          progress,
          percentage: unitStartPercentage(offsets, index),
          baseUpdatedAt: state.base,
        });
        if (!result.pushed) {
          // Stale means KOReader is ahead; unlinked/disabled/not-exact mean
          // this book cannot push. Stop for the session either way.
          state.stalled = true;
          state.pending = null;
          return;
        }
        state.lastPushed = index;
        if (result.updatedAt !== undefined) state.base = result.updatedAt;
      } catch {
        // Offline or a transient server error: keep the local position and
        // try again on the next change. Never block reading.
      }
    },
    [
      api,
      pushable,
      article.sourceFilename,
      chapterUnitStarts,
      chapterBodyStarts,
      units.length,
      offsets,
    ],
  );

  const pushPosition = useCallback(
    (index: number) => {
      if (!api || !pushable || !lookupDone) return;
      const state = pushRef.current;
      if (state.stalled) return;
      state.pending = index;
      if (state.running) return;
      state.running = true;
      void (async () => {
        try {
          // Coalesce rapid page turns: always write the latest index, and
          // serialize writes so each one sees the base from the last ack.
          while (state.pending !== null && !state.stalled) {
            const next = state.pending;
            state.pending = null;
            await sendPosition(state, next);
          }
        } finally {
          state.running = false;
        }
      })();
    },
    [api, pushable, lookupDone, sendPosition],
  );

  useEffect(() => {
    if (!enabled || !ready || !pushable || !lookupDone) return;
    if (localIndex === null || prompt !== null) return;
    if (pushRef.current.lastPushed === localIndex) return;
    const timer = setTimeout(() => pushPosition(localIndex), PUSH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [enabled, ready, pushable, lookupDone, localIndex, prompt, pushPosition]);

  // A TWA can be backgrounded at any moment; flush the last sentence while
  // the request still has a chance to complete. keepalive does the rest.
  useEffect(() => {
    if (!enabled || !pushable || prompt !== null) return;
    const flush = () => {
      const index = latestIndexRef.current;
      if (index !== null) pushPosition(index);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", flush);
    };
  }, [enabled, pushable, prompt, pushPosition]);

  const remember = useCallback(
    (value: KosyncPrompt) => {
      const dismissal = {
        document: value.document,
        updatedAt: value.updatedAt,
        version: KOSYNC_MAPPING_VERSION,
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
    // The app is already at this position now; do not echo a redundant push.
    pushRef.current.lastPushed = prompt.index;
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
