// Whole-book finish: drive translation from the cache frontier to the end of
// the book — the export flow's "translate everything first" — with
// sentence-granular progress. Unlike the reader's prefetch session there is
// no reading anchor and no attempt cap: the run scans forward for the first
// sentence still missing, translates windows front to back until the book is
// covered, a failure stops it visibly, or it is disposed.
import type { BookSentenceUnit } from "./bookText";
import {
  type BookTranslationDeps,
  errorStatus,
  readCachedTranslations,
  translateWindow,
} from "./bookTranslation";
import {
  BOOK_WINDOW_LIMITS,
  type BookWindowLimits,
  nextWindow,
} from "./bookWindow";

export interface BookFinishProgress {
  done: number;
  total: number;
}

export type BookFinishStatus = "working" | "paused" | "quota" | "auth" | "done";

export interface BookFinishSession {
  dispose(): void;
  status(): BookFinishStatus;
  progress(): BookFinishProgress;
  onUpdate(listener: () => void): () => void;
}

export const SCAN_BATCH_UNITS = 500;

/**
 * Start finishing a whole book. The session starts in "working" and runs on
 * its own; the caller watches `onUpdate` for progress and status changes and
 * must `dispose` it when the book closes.
 */
export function startBookFinish(args: {
  deps: BookTranslationDeps;
  units: readonly BookSentenceUnit[];
  keyFor: (unitIndex: number) => Promise<string>;
  model: string;
  system: string;
  targetLanguage: string;
  rulesHashValue: string;
  limits?: BookWindowLimits;
  scanBatchUnits?: number;
}): BookFinishSession {
  const { deps, units, keyFor, model, system, targetLanguage, rulesHashValue } =
    args;
  const limits = args.limits ?? BOOK_WINDOW_LIMITS;
  const scanBatchUnits = args.scanBatchUnits ?? SCAN_BATCH_UNITS;
  const total = units.length;

  let disposed = false;
  let status: BookFinishStatus = "working";
  let done = 0;
  let inflight: AbortController | null = null;
  const listeners = new Set<() => void>();

  function notify(): void {
    if (disposed) return;
    for (const listener of [...listeners]) {
      if (disposed) return; // a listener disposed mid-dispatch
      listener();
    }
  }

  function stop(next: BookFinishStatus): void {
    status = next;
    notify();
  }

  async function run(): Promise<void> {
    let scanFrom = 0;
    // Frontier of the last accepted pass. If the next scan finds the frontier
    // unmoved, the cache write was lost or a key cannot verify: stop instead
    // of paying for the same window on every pass.
    let translatedFrontier = -1;
    for (;;) {
      // Scan forward from the last frontier in batches, merging verified
      // cache hits; the first non-skipped uncached unit is where work resumes.
      const cachedMap = new Map<number, string>();
      let found = -1;
      for (
        let batchStart = scanFrom;
        batchStart < total;
        batchStart += scanBatchUnits
      ) {
        const batchEnd = Math.min(batchStart + scanBatchUnits, total);
        const unitIndices = Array.from(
          { length: batchEnd - batchStart },
          (_, offset) => batchStart + offset,
        );
        try {
          const batchCached = await readCachedTranslations({
            store: deps.store,
            units,
            unitIndices,
            keyFor,
            targetLanguage,
            rulesHashValue,
          });
          if (disposed) return;
          for (const [unitIndex, translation] of batchCached) {
            cachedMap.set(unitIndex, translation);
          }
        } catch (error) {
          if (disposed) return;
          stop(errorStatus(error));
          return;
        }
        for (const unitIndex of unitIndices) {
          const unit = units[unitIndex];
          if (unit === undefined || unit.skipped) continue;
          if (!cachedMap.has(unitIndex)) {
            found = unitIndex;
            break;
          }
        }
        if (found >= 0) break;
        if (batchEnd < total) {
          await new Promise((resolve) => setTimeout(resolve, 0));
          if (disposed) return;
        }
      }
      if (found < 0) {
        done = total;
        stop("done");
        return;
      }
      if (found <= translatedFrontier) {
        stop("paused");
        return;
      }

      done = found;
      notify();
      // `found` is known-missing, so the plan starts exactly there and runs
      // to the caps, crossing cached runs after the hole in this window only.
      const plan = nextWindow({
        units,
        anchor: found,
        cached: (unitIndex) =>
          cachedMap.has(unitIndex) || units[unitIndex]?.skipped === true,
        limits,
      });
      if (plan === null) {
        done = total;
        stop("done");
        return;
      }

      const controller = new AbortController();
      inflight = controller;
      let accepted: number;
      try {
        accepted = await translateWindow({
          deps,
          model,
          system,
          units,
          plan,
          keyFor,
          targetLanguage,
          rulesHashValue,
          signal: controller.signal,
        });
      } catch (error) {
        inflight = null;
        if (disposed) return;
        stop(errorStatus(error));
        return;
      }
      inflight = null;
      if (disposed) return;
      if (accepted === 0) {
        stop("paused");
        return;
      }
      translatedFrontier = found;
      scanFrom = plan.start;
    }
  }

  void run();

  return {
    dispose(): void {
      if (disposed) return;
      disposed = true;
      inflight?.abort();
      inflight = null;
      listeners.clear();
    },

    status: () => status,

    progress: () => ({ done, total }),

    onUpdate(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
