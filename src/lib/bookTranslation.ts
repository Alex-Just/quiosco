// Book translation IO: verified reads from the sentence cache, one window
// per request (tagged prompt → strict-prefix parse → cache write), and the
// sequential prefetch session that keeps the runway ahead of the reading
// position translated.
import { AuthError, QuotaError } from "./apiErrors";
import type { BookSentenceUnit } from "./bookText";
import {
  BOOK_WINDOW_LIMITS,
  type BookWindowLimits,
  nextWindow,
  type WindowPlan,
} from "./bookWindow";
import { repairFlagMarkers } from "./flagLines";
import { parseNumberedTranslations } from "./numberedTranslations";
import { buildBookUserMessage } from "./prompt";
import type { ArticleStore } from "./store";
import type { SentenceCacheEntry } from "./types";

export interface BookTranslationDeps {
  store: Pick<ArticleStore, "getSentences" | "putSentences">;
  translate: (
    request: { model: string; system: string; text: string },
    signal?: AbortSignal,
  ) => Promise<string>;
}

/** Scheduler state: idle, translating, paused on errors, or blocked on auth/quota. */
export type BookTranslationStatus =
  | "idle"
  | "working"
  | "paused"
  | "quota"
  | "auth";

/** The status a failed window leaves behind: sign-in and quota are distinct. */
export function errorStatus(error: unknown): "paused" | "quota" | "auth" {
  if (error instanceof AuthError) return "auth";
  if (error instanceof QuotaError) return "quota";
  return "paused";
}

// A unit whose key cannot be computed cannot take part in a content-addressed
// cache: reads see a miss, writes skip that unit, the window still succeeds.
async function resolvedKey(
  keyFor: (unitIndex: number) => Promise<string>,
  unitIndex: number,
): Promise<string | undefined> {
  try {
    return (await keyFor(unitIndex)) || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Verified cache hits for the requested unit indices. An entry counts only
 * when it holds the exact source text, target language and rules asked for,
 * so a key collision or a stale entry can never leak the wrong translation.
 * Identical texts share one key, so one entry can fill many indices.
 */
export async function readCachedTranslations(args: {
  store: Pick<ArticleStore, "getSentences">;
  units: readonly BookSentenceUnit[];
  unitIndices: readonly number[];
  keyFor: (unitIndex: number) => Promise<string>;
  targetLanguage: string;
  rulesHashValue: string;
}): Promise<Map<number, string>> {
  const { store, units, unitIndices, keyFor, targetLanguage, rulesHashValue } =
    args;

  const keyed = await Promise.all(
    unitIndices.map(async (unitIndex) => {
      const unit = units[unitIndex];
      if (unit === undefined || unit.skipped) return null;
      const key = await resolvedKey(keyFor, unitIndex);
      return key === undefined ? null : { key, unitIndex };
    }),
  );
  const indicesByKey = new Map<string, number[]>();
  for (const item of keyed) {
    if (item === null) continue;
    const indices = indicesByKey.get(item.key);
    if (indices === undefined) indicesByKey.set(item.key, [item.unitIndex]);
    else indices.push(item.unitIndex);
  }

  const entries = await store.getSentences([...indicesByKey.keys()]);
  const entriesByKey = new Map(entries.map((entry) => [entry.key, entry]));
  const translations = new Map<number, string>();
  for (const [key, indices] of indicesByKey) {
    const entry = entriesByKey.get(key);
    if (entry === undefined) continue;
    for (const unitIndex of indices) {
      const unit = units[unitIndex];
      if (unit === undefined) continue;
      if (
        entry.source === unit.text &&
        entry.targetLanguage === targetLanguage &&
        entry.rulesHash === rulesHashValue
      ) {
        translations.set(unitIndex, entry.translation);
      }
    }
  }
  return translations;
}

/**
 * Translate one planned window and cache it: sends the unit texts in
 * `[start, end)` with their context, accepts only the strict numbered prefix
 * of the reply, and writes one entry per accepted sentence. Returns how many
 * sentences were cached; a partial reply costs at most a re-request of the
 * remainder.
 */
export async function translateWindow(args: {
  deps: BookTranslationDeps;
  model: string;
  system: string;
  units: readonly BookSentenceUnit[];
  plan: WindowPlan;
  keyFor: (unitIndex: number) => Promise<string>;
  targetLanguage: string;
  rulesHashValue: string;
  signal?: AbortSignal;
}): Promise<number> {
  const {
    deps,
    model,
    system,
    units,
    plan,
    keyFor,
    targetLanguage,
    rulesHashValue,
    signal,
  } = args;

  const indices: number[] = [];
  const sentences: string[] = [];
  for (let i = plan.start; i < plan.end; i++) {
    const unit = units[i];
    if (unit === undefined || unit.skipped) continue;
    indices.push(i);
    sentences.push(unit.text);
  }

  const raw = await deps.translate(
    {
      model,
      system,
      text: buildBookUserMessage({
        before: plan.contextBefore,
        sentences,
        after: plan.contextAfter,
      }),
    },
    signal,
  );
  const parsed = parseNumberedTranslations(raw, sentences.length);

  const entries: SentenceCacheEntry[] = [];
  for (const [position, translation] of parsed) {
    const unitIndex = indices[position - 1];
    if (unitIndex === undefined) continue;
    const unit = units[unitIndex];
    if (unit === undefined) continue;
    const key = await resolvedKey(keyFor, unitIndex);
    if (key === undefined) continue;
    entries.push({
      key,
      source: unit.text,
      translation: repairFlagMarkers(translation),
      targetLanguage,
      rulesHash: rulesHashValue,
      model,
      createdAt: Date.now(),
    });
  }
  if (entries.length > 0) await deps.store.putSentences(entries);
  return entries.length;
}

/**
 * Window requests a single loop run may start for one anchor before idling;
 * the next kick (anchor change or retry) gets a fresh budget and continues
 * from the first missing sentence.
 */
export const MAX_ATTEMPTS_PER_ANCHOR = 3;

/** The prefetch loop's control surface; `setAnchor` drives the session. */
export interface BookTranslationSession {
  setAnchor(paragraphIndex: number): void;
  retry(): void;
  dispose(): void;
  status(): BookTranslationStatus;
  onUpdate(listener: () => void): () => void;
}

/**
 * Start the sequential prefetch loop for one open book. Every pass reads the
 * verified cache for a scan range from the anchor, plans the next window with
 * `nextWindow` and translates it, until the runway ahead is covered, a
 * failure stops the loop with a visible status, or the per-anchor attempt cap
 * is reached. There is no timer and no retry inside the loop: `setAnchor`
 * and `retry` restart it, `dispose` ends it.
 */
export function startBookTranslation(args: {
  deps: BookTranslationDeps;
  units: readonly BookSentenceUnit[];
  paragraphUnits: ReadonlyMap<number, readonly number[]>;
  keyFor: (unitIndex: number) => Promise<string>;
  model: string;
  system: string;
  targetLanguage: string;
  rulesHashValue: string;
  limits?: BookWindowLimits;
}): BookTranslationSession {
  const {
    deps,
    units,
    paragraphUnits,
    keyFor,
    model,
    system,
    targetLanguage,
    rulesHashValue,
  } = args;
  const limits = args.limits ?? BOOK_WINDOW_LIMITS;
  const scanBudget =
    limits.runwayChars + limits.maxChars + 2 * limits.contextChars;

  // Session state. The loop is the only writer while it runs; each await is
  // followed synchronously by a disposed/stale check, so a pass that was
  // superseded can never touch a newer one.
  let disposed = false;
  let status: BookTranslationStatus = "idle";
  let anchor = -1;
  let attempts = 0;
  let running = false;
  // True while the loop is dispatching its final status notification. A kick
  // a listener issues in that window is queued (`pendingKick`) because the
  // loop is exiting; anything else honors the kick by re-planning itself.
  let exiting = false;
  let pendingKick = false;
  let inflight: { controller: AbortController; plan: WindowPlan } | null = null;
  const listeners = new Set<() => void>();

  function notify(): void {
    if (disposed) return;
    for (const listener of [...listeners]) {
      if (disposed) return; // a listener disposed mid-dispatch
      listener();
    }
  }

  function setStatus(next: BookTranslationStatus): void {
    if (status === next) return;
    status = next;
    notify();
  }

  // Leaves the loop with `next`. Marked as exiting first so a listener that
  // reacts to this notification (retry, setAnchor) queues a kick instead of
  // hitting a still-running loop; `run`'s finally honors it.
  function stop(next: BookTranslationStatus): void {
    exiting = true;
    setStatus(next);
  }

  function sticky(): boolean {
    return status === "auth" || status === "quota";
  }

  // The cache read range: everything from the anchor that one pass can
  // consult — the cached runway, the window itself and its after-context.
  function scanIndices(from: number): number[] {
    const indices: number[] = [];
    let total = 0;
    for (let i = from; i < units.length; i++) {
      const unit = units[i];
      if (unit === undefined) break;
      if (!unit.skipped) {
        if (total + unit.text.length > scanBudget) break;
        total += unit.text.length;
      }
      indices.push(i);
    }
    return indices;
  }

  async function run(): Promise<void> {
    if (running || disposed) return;
    running = true;
    try {
      for (;;) {
        if (disposed) return;
        if (sticky()) return;
        if (anchor < 0) return;
        if (attempts >= MAX_ATTEMPTS_PER_ANCHOR) {
          stop("idle");
          return;
        }
        const passAnchor = anchor;
        setStatus("working");
        let translations: Map<number, string>;
        try {
          translations = await readCachedTranslations({
            store: deps.store,
            units,
            unitIndices: scanIndices(passAnchor),
            keyFor,
            targetLanguage,
            rulesHashValue,
          });
        } catch (error) {
          if (disposed) return;
          stop(errorStatus(error));
          return;
        }
        if (disposed) return;
        if (anchor !== passAnchor) continue; // re-anchor, re-plan
        const plan = nextWindow({
          units,
          anchor,
          cached: (i) => units[i]?.skipped === true || translations.has(i),
          limits,
        });
        if (plan === null) {
          stop("idle");
          return;
        }
        const controller = new AbortController();
        inflight = { controller, plan };
        attempts += 1;
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
          if (controller.signal.aborted) continue; // superseded, re-plan
          stop(errorStatus(error));
          return;
        }
        inflight = null;
        if (disposed) return;
        if (accepted > 0) notify(); // the window wrote cache entries
        if (accepted === 0) {
          stop("paused");
          return;
        }
      }
    } finally {
      running = false;
      exiting = false;
      if (pendingKick) {
        // A kick arrived while the loop was exiting; honor it with a fresh
        // run (kick re-checks disposed and sticky quota/auth).
        pendingKick = false;
        kick();
      }
    }
  }

  function kick(): void {
    if (disposed || sticky()) return;
    if (running) {
      // The loop is still finishing its last notification: queue the kick for
      // `run`'s finally. A kick while the loop is mid-pass needs no flag —
      // the pass re-reads the anchor and re-plans on its own.
      if (exiting) pendingKick = true;
      return;
    }
    void run();
  }

  return {
    setAnchor(paragraphIndex: number): void {
      if (disposed) return;
      const indices = paragraphUnits.get(paragraphIndex);
      if (indices === undefined || indices.length === 0) return;
      const first = indices[0];
      if (first === undefined) return;
      let unit = first;
      for (const index of indices) {
        const candidate = units[index];
        if (candidate !== undefined && !candidate.skipped) {
          unit = index;
          break;
        }
      }
      if (unit === anchor) return;
      anchor = unit;
      attempts = 0;
      if (
        inflight !== null &&
        unit >= inflight.plan.start &&
        unit < inflight.plan.end
      ) {
        return; // the running request covers it; the loop re-plans after
      }
      inflight?.controller.abort();
      kick();
    },

    retry(): void {
      if (disposed || sticky()) return;
      if (running && !exiting) return; // a live loop restarts itself
      attempts = 0;
      if (status === "paused") setStatus("idle");
      kick();
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      inflight?.controller.abort();
      inflight = null;
      listeners.clear();
    },

    status: () => status,

    onUpdate(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
