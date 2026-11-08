// Narrated playback for one open book: load its pack, import a new one, and
// play the sentence unit on screen straight from the recorded audiobook.
// A pack is local-only (IndexedDB), like the rest of a book's row.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  locateUnit,
  NarrationError,
  type NarrationPack,
} from "./narration/manifest";
import { readNarrationPack } from "./narration/pack";
import { playNarrationSegment, stopNarration } from "./narration/player";
import type { ArticleStore } from "./store";

export interface NarrationHook {
  /** A pack is stored for this book. */
  ready: boolean;
  /** Sentence unit playing right now, or null. */
  speakingUnit: number | null;
  /** An import is running. */
  importing: boolean;
  /** Last import failure, already phrased for the reader. */
  error: string | null;
  /** Import a pack zip picked by the user. */
  load(file: File): void;
  remove(): void;
  /** Play `unit`, or stop when it is the one already playing. */
  toggle(unit: number): void;
  /** True when this unit has recorded audio (front matter has none). */
  canPlay(unit: number): boolean;
  stop(): void;
}

const IMPORT_FAILED = "Could not import this audiobook.";
const PACK_MISMATCH =
  "This pack was built for a different edition of this book.";

/** A pack is only usable when its chapters line up with the reader's. */
function fitsBook(pack: NarrationPack, chapters: number): boolean {
  return pack.chapters.length === chapters;
}

function importErrorMessage(error: unknown): string {
  if (error instanceof NarrationError) return error.message;
  if (
    error instanceof DOMException &&
    (error.name === "QuotaExceededError" || error.code === 22)
  ) {
    return "Not enough free storage for this audiobook.";
  }
  return IMPORT_FAILED;
}

/**
 * `chapterUnitStarts` is `bookUnitStarts(units, chapterStarts)`: the first
 * sentence unit of every chapter, matching the pack's chapter order. It
 * changes identity when the book's chapters change, which reloads the hook.
 */
export function useNarration(args: {
  store: ArticleStore;
  bookId: string;
  chapterUnitStarts: readonly number[];
  /** Fired when a segment reaches its natural end (not on stop). */
  onEnded?: (unit: number) => void;
}): NarrationHook {
  const { store, bookId, chapterUnitStarts } = args;
  const [pack, setPack] = useState<NarrationPack | null>(null);
  const [speakingUnit, setSpeakingUnit] = useState<number | null>(null);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Imperative callbacks read these; the state copies only drive rendering.
  const packRef = useRef<NarrationPack | null>(null);
  const speakingRef = useRef<number | null>(null);
  const startsRef = useRef(chapterUnitStarts);
  const endedRef = useRef(args.onEnded);
  /** Invalidates the handlers of a segment that a newer action replaced. */
  const runRef = useRef(0);
  /** Cancels a pack import once the book changes or another import starts. */
  const importRun = useRef(0);
  startsRef.current = chapterUnitStarts;
  endedRef.current = args.onEnded;

  const applySpeaking = useCallback((unit: number | null) => {
    speakingRef.current = unit;
    setSpeakingUnit(unit);
  }, []);

  const stop = useCallback(() => {
    runRef.current += 1;
    stopNarration();
    speakingRef.current = null;
    setSpeakingUnit(null);
  }, []);

  const canPlay = useCallback((unit: number) => {
    const currentPack = packRef.current;
    if (!currentPack) return false;
    const spot = locateUnit(startsRef.current, unit);
    if (!spot) return false;
    const chapter = currentPack.chapters[spot.chapter];
    return (
      chapter !== undefined &&
      chapter.size > 0 &&
      chapter.starts[spot.local] !== undefined
    );
  }, []);

  const toggle = useCallback(
    (unit: number) => {
      if (speakingRef.current === unit) {
        stop();
        return;
      }
      const currentPack = packRef.current;
      if (!currentPack) return;
      const spot = locateUnit(startsRef.current, unit);
      if (!spot) return;
      const chapter = currentPack.chapters[spot.chapter];
      const start = chapter?.starts[spot.local];
      const end = chapter?.ends[spot.local];
      if (
        !chapter ||
        chapter.size === 0 ||
        start === undefined ||
        end === undefined
      ) {
        return;
      }

      runRef.current += 1;
      const run = runRef.current;
      applySpeaking(unit);
      void playNarrationSegment(currentPack, chapter, start, end, {
        onEnd: () => {
          if (runRef.current !== run) return;
          applySpeaking(null);
          endedRef.current?.(unit);
        },
        onError: () => {
          if (runRef.current !== run) return;
          applySpeaking(null);
        },
      }).catch(() => {
        if (runRef.current !== run) return;
        applySpeaking(null);
      });
    },
    [stop, applySpeaking],
  );

  const load = useCallback(
    (file: File) => {
      importRun.current += 1;
      const run = importRun.current;
      const current = () => importRun.current === run;
      setImporting(true);
      setError(null);
      void (async () => {
        try {
          const next = await readNarrationPack(file);
          if (!current()) return;
          if (!fitsBook(next, startsRef.current.length)) {
            setError(PACK_MISMATCH);
            return;
          }
          await store.putNarration(bookId, next);
          if (!current()) return;
          packRef.current = next;
          setPack(next);
        } catch (importError) {
          if (!current()) return;
          setError(importErrorMessage(importError));
        } finally {
          if (current()) setImporting(false);
        }
      })();
    },
    [store, bookId],
  );

  const remove = useCallback(() => {
    importRun.current += 1;
    setImporting(false);
    stop();
    packRef.current = null;
    setPack(null);
    void store.removeNarration(bookId);
  }, [store, bookId, stop]);

  // One pack per book: leaving the book ends its playback and drops any
  // import still running for the book that was open.
  useEffect(() => {
    importRun.current += 1;
    let alive = true;
    packRef.current = null;
    speakingRef.current = null;
    setPack(null);
    setSpeakingUnit(null);
    setImporting(false);
    setError(null);
    void store
      .getNarration(bookId)
      .then((found) => {
        if (!alive || !found) return;
        if (!fitsBook(found, startsRef.current.length)) {
          setError(PACK_MISMATCH);
          return;
        }
        packRef.current = found;
        setPack(found);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
      runRef.current += 1;
      stopNarration();
    };
  }, [store, bookId]);

  return {
    ready: pack !== null,
    speakingUnit,
    importing,
    error,
    load,
    remove,
    toggle,
    canPlay,
    stop,
  };
}
