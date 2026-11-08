// Forced alignment for pre-recorded narration: map every sentence unit of a
// chapter onto a [start, end] range of that chapter's audio.
//
// The expensive, unreliable part (speech recognition) happens offline; this
// module only solves text-to-text. Both sides are the same translation, so a
// global Needleman-Wunsch alignment over folded word tokens recovers the word
// correspondence exactly, and the transcript's word times carry the audio
// over. Sentences the transcript missed or misread are interpolated from their
// neighbours by character length, so every unit still gets a playable range.

export interface TimedWord {
  /** One transcript word, as produced by the recognizer. */
  text: string;
  /** Seconds from the start of the chapter audio. */
  start: number;
  /** Seconds from the start of the chapter audio. */
  end: number;
}

export interface ChapterAlignment {
  /** Seconds into the chapter audio where each unit starts. */
  starts: number[];
  /** Seconds into the chapter audio where each unit ends. */
  ends: number[];
  /** Share of book tokens matched to a transcript token, 0..1. */
  coverage: number;
}

/** Score for an identical token pair. */
const MATCH = 2;
/** Score for a substitution (an OCR slip, a misread word). */
const MISMATCH = -1;
/** Score for consuming a token on one side only. */
const GAP = -1;

/**
 * Cell cap for the O(n·m) matrix. The largest chapter of a 200k-word book is
 * well under this; the guard only exists so a pathological input fails loudly
 * instead of exhausting the heap.
 */
const MAX_CELLS = 150_000_000;

/** Fold a token for comparison: case and accents stop mattering. */
export function foldToken(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase();
}

/** Comparison tokens of a text: letters and digits only, accent-folded. */
export function tokenize(text: string): string[] {
  return Array.from(text.matchAll(/[\p{L}\p{N}]+/gu), (match) =>
    foldToken(match[0]),
  );
}

/**
 * For each token of `book`, the index of its partner in `spoken`, or -1 when
 * the token has no counterpart. Classic Needleman-Wunsch; `direction` records
 * the move taken per cell so the walk back can recover the pairing.
 */
function pairTokens(
  book: readonly string[],
  spoken: readonly string[],
): Int32Array {
  const rows = book.length;
  const cols = spoken.length;
  const pairs = new Int32Array(rows).fill(-1);
  if (rows === 0 || cols === 0) return pairs;
  if (rows * cols > MAX_CELLS) {
    throw new Error(
      `alignChapter: ${rows}x${cols} tokens exceeds the ${MAX_CELLS} cell cap`,
    );
  }

  // 1 = diagonal, 2 = skip a book token, 3 = skip a spoken token.
  const direction = new Uint8Array(rows * cols);
  let previous = new Int32Array(cols + 1);
  let current = new Int32Array(cols + 1);
  for (let col = 1; col <= cols; col += 1) {
    previous[col] = (previous[col - 1] ?? 0) + GAP;
  }

  for (let row = 1; row <= rows; row += 1) {
    current[0] = (previous[0] ?? 0) + GAP;
    const token = book[row - 1] ?? "";
    const offset = (row - 1) * cols;
    for (let col = 1; col <= cols; col += 1) {
      const diagonal =
        (previous[col - 1] ?? 0) +
        (token === spoken[col - 1] ? MATCH : MISMATCH);
      const skipBook = (previous[col] ?? 0) + GAP;
      const skipSpoken = (current[col - 1] ?? 0) + GAP;
      let best = diagonal;
      let move = 1;
      if (skipSpoken > best) {
        best = skipSpoken;
        move = 3;
      }
      if (skipBook > best) {
        best = skipBook;
        move = 2;
      }
      current[col] = best;
      direction[offset + col - 1] = move;
    }
    const swap = previous;
    previous = current;
    current = swap;
  }

  let row = rows;
  let col = cols;
  while (row > 0 && col > 0) {
    const move = direction[(row - 1) * cols + (col - 1)] ?? 0;
    if (move === 1) {
      if (book[row - 1] === spoken[col - 1]) pairs[row - 1] = col - 1;
      row -= 1;
      col -= 1;
    } else if (move === 2) {
      row -= 1;
    } else {
      col -= 1;
    }
  }

  return pairs;
}

/**
 * Fill every not-a-number slot of `values` from its nearest known neighbours,
 * splitting the span by `weights`. `floor` and `ceiling` bound the ends of the
 * chapter, so leading and trailing gaps are covered too.
 */
function interpolate(
  values: Float64Array,
  weights: readonly number[],
  floor: number,
  ceiling: number,
): void {
  const total = values.length;
  let index = 0;
  while (index < total) {
    const known = values[index];
    if (known !== undefined && !Number.isNaN(known)) {
      index += 1;
      continue;
    }
    let end = index;
    while (end < total) {
      const value = values[end];
      if (value !== undefined && !Number.isNaN(value)) break;
      end += 1;
    }
    const from = index > 0 ? (values[index - 1] ?? floor) : floor;
    const to = end < total ? (values[end] ?? ceiling) : ceiling;
    const span = Math.max(0, to - from);
    let weight = 0;
    for (let slot = index; slot < end; slot += 1) weight += weights[slot] ?? 1;
    let walked = 0;
    for (let slot = index; slot < end; slot += 1) {
      const own = weights[slot] ?? 1;
      // Each unknown sits at the middle of its own share of the gap, so a
      // lone missing sentence lands halfway between its neighbours.
      values[slot] = from + (span * (walked + own / 2)) / (weight || 1);
      walked += own;
    }
    index = end;
  }
}

/**
 * Sentence-unit ranges for one chapter. `duration` is the chapter audio length
 * and only bounds the final unit; it may be 0 when unknown.
 */
export function alignChapter(
  units: readonly string[],
  words: readonly TimedWord[],
  duration: number,
): ChapterAlignment {
  const book: string[] = [];
  const unitOfToken: number[] = [];
  units.forEach((text, unit) => {
    for (const token of tokenize(text)) {
      book.push(token);
      unitOfToken.push(unit);
    }
  });

  const spoken: string[] = [];
  const startOfToken: number[] = [];
  for (const word of words) {
    for (const token of tokenize(word.text)) {
      spoken.push(token);
      startOfToken.push(word.start);
    }
  }

  const pairs = pairTokens(book, spoken);

  const starts = new Float64Array(units.length).fill(Number.NaN);
  let matched = 0;
  for (let index = 0; index < book.length; index += 1) {
    const partner = pairs[index] ?? -1;
    if (partner < 0) continue;
    matched += 1;
    const unit = unitOfToken[index] ?? 0;
    if (Number.isNaN(starts[unit])) {
      starts[unit] = startOfToken[partner] ?? 0;
    }
  }

  const lastWordEnd = words.at(-1)?.end ?? 0;
  const length = Math.max(duration, lastWordEnd);
  const weights = units.map((text) => Math.max(1, text.length));
  interpolate(starts, weights, 0, length);

  const startList = Array.from(starts, (value) =>
    Math.min(Math.max(value, 0), length),
  );
  const endList = startList.map((_, index) => startList[index + 1] ?? length);

  return {
    starts: startList,
    ends: endList,
    coverage: book.length === 0 ? 0 : matched / book.length,
  };
}
