import type { BookSentenceUnit } from "./bookText";

/** Caps for one translation window and its surrounding source context. */
export interface BookWindowLimits {
  maxChars: number;
  maxSentences: number;
  contextChars: number;
  runwayChars: number;
}

/** Defaults: 4k chars / 60 sentences, 1.2k context a side, 4k runway. */
export const BOOK_WINDOW_LIMITS: BookWindowLimits = {
  maxChars: 4_000,
  maxSentences: 60,
  contextChars: 1_200,
  runwayChars: 4_000,
};

/** One translation request: units in `[start, end)` plus context texts. */
export interface WindowPlan {
  start: number;
  end: number;
  contextBefore: string[];
  contextAfter: string[];
}

// Non-skipped source texts from `from` walking by `step` while their total
// stays within `budget`; stops at the first text that does not fit.
function collectContext(
  units: readonly BookSentenceUnit[],
  from: number,
  step: 1 | -1,
  budget: number,
): string[] {
  const texts: string[] = [];
  for (let i = from; i >= 0 && i < units.length; i += step) {
    const unit = units[i];
    if (unit == null || unit.skipped) continue;
    if (unit.text.length > budget) break;
    budget -= unit.text.length;
    texts.push(unit.text);
  }
  return texts;
}

/**
 * Plan the next translation window for a reading anchor: the first
 * non-skipped uncached unit at or after the anchor, extended forward while
 * `maxChars` and `maxSentences` allow, with source-language context on both
 * sides. Null when the anchor is already covered for the runway ahead.
 */
export function nextWindow(args: {
  units: readonly BookSentenceUnit[];
  anchor: number;
  cached: (unitIndex: number) => boolean;
  limits?: BookWindowLimits;
}): WindowPlan | null {
  const { units, cached } = args;
  const limits = args.limits ?? BOOK_WINDOW_LIMITS;
  if (units.length === 0) return null;
  const anchor = Math.min(Math.max(args.anchor, 0), units.length - 1);

  // Runway: walk over skipped and cached units, summing translated text of
  // non-skipped ones. Enough covered text ahead of the anchor ends prefetch.
  let runway = 0;
  let start = -1;
  for (let i = anchor; i < units.length; i++) {
    const unit = units[i];
    if (unit == null || unit.skipped) continue;
    if (!cached(i)) {
      start = i;
      break;
    }
    runway += unit.text.length;
    if (runway >= limits.runwayChars) return null;
  }
  if (start < 0) return null;

  // Window: non-skipped units from `start` while they fit the caps; skipped
  // units are pulled into the range, never counted, and the first non-skipped
  // unit is always included.
  let end = start;
  let sentences = 0;
  let chars = 0;
  for (let i = start; i < units.length; i++) {
    const unit = units[i];
    if (unit == null) break;
    if (unit.skipped) {
      end = i + 1;
      continue;
    }
    if (sentences > 0) {
      if (sentences >= limits.maxSentences) break;
      if (chars + unit.text.length > limits.maxChars) break;
    }
    sentences += 1;
    chars += unit.text.length;
    end = i + 1;
  }
  if (sentences === 0) return null;

  const contextBefore = collectContext(
    units,
    start - 1,
    -1,
    limits.contextChars,
  );
  contextBefore.reverse();
  return {
    start,
    end,
    contextBefore,
    contextAfter: collectContext(units, end, 1, limits.contextChars),
  };
}
