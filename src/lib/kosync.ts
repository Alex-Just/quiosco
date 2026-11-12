import type { BookSentenceUnit } from "./bookText";
import type {
  KosyncProgress,
  KosyncPushReason,
  KosyncPushResult,
} from "./types";

/**
 * KOReader sends two position signals: a CRe XPointer and a pagination
 * percentage. A quiosco-generated bilingual export has a deterministic
 * structure (`DocFragment` = chapter, `p` = sentence unit), so its XPointer
 * resolves exactly. Any other EPUB's paragraph index does not match quiosco's
 * sentence units, so those fall back to the approximate percentage mapping.
 *
 * Percentage matches only offer forward jumps, mirroring KOReader's default
 * `sync_backward = DISABLE`. An exact bilingual match may be behind the local
 * position: that is how a previous approximate jump gets corrected.
 */
export const KOSYNC_PROMPT_MIN_AHEAD = 0.002;

/** Bump when the mapping changes so old dismissals cannot hide a correction. */
export const KOSYNC_MAPPING_VERSION = 3;

export interface UnitOffsets {
  /** Character offset where each unit starts. */
  starts: number[];
  /** Total characters across all units. */
  total: number;
}

export interface KosyncPrompt {
  /** Sentence-unit index in quiosco's Zen reader. */
  index: number;
  percentage: number;
  device: string;
  document: string;
  /** Unix seconds of the remote push, used to debounce repeat prompts. */
  updatedAt: number;
}

export interface KosyncDismissal {
  document: string;
  updatedAt: number;
  /** Mapping generation that produced the dismissal. */
  version: number;
}

type StorageLike = Pick<Storage, "getItem" | "setItem">;

const DISMISSED_PREFIX = "quiosco.kosync.dismissed.";

const BILINGUAL_XPOINTER =
  /^\/body\/DocFragment\[(\d+)\]\/body\/p\[(\d+)\]\/br\[1\](?:\.\d+)?$/;
const BILINGUAL_EXPORT = /-bilingual(?:[ ._-][^/]*)?\.epub$/i;

/**
 * True for a quiosco bilingual export, the only EPUB with exact XPointers.
 * A version suffix is allowed (`-bilingual-v5.epub`, `-bilingual (2).epub`);
 * the export structure, not the exact basename, is what makes it exact.
 */
export function isBilingualExportFilename(
  value: string | null | undefined,
): boolean {
  return typeof value === "string" && BILINGUAL_EXPORT.test(value);
}

export function unitOffsets(units: readonly BookSentenceUnit[]): UnitOffsets {
  const starts = new Array<number>(units.length);
  let total = 0;
  for (let index = 0; index < units.length; index += 1) {
    starts[index] = total;
    total += units[index]?.text.length ?? 0;
  }
  return { starts, total };
}

/** Last unit whose start is at or before `percentage` of the book. */
export function unitIndexAtPercentage(
  offsets: UnitOffsets,
  percentage: number,
): number | null {
  const count = offsets.starts.length;
  if (count === 0 || offsets.total <= 0 || !Number.isFinite(percentage)) {
    return null;
  }
  const target = Math.min(1, Math.max(0, percentage)) * offsets.total;
  let low = 0;
  let high = count - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if ((offsets.starts[mid] ?? 0) <= target) low = mid;
    else high = mid - 1;
  }
  return low;
}

export function unitStartPercentage(
  offsets: UnitOffsets,
  index: number,
): number {
  if (offsets.total <= 0) return 0;
  return (offsets.starts[index] ?? 0) / offsets.total;
}

/**
 * Exact unit for a quiosco bilingual export. `chapterBodyStarts[i]` is the
 * first body unit after chapter i's title; the export's `p[N]` is 1-based
 * from that point. The filename guard keeps a normal EPUB's DOM paragraph
 * index from being mistaken for an export sentence index.
 */
export function bilingualXPointerUnitIndex(args: {
  progress: string;
  filename: string | null;
  chapterBodyStarts: readonly number[];
  unitCount: number;
}): number | null {
  const { progress, filename, chapterBodyStarts, unitCount } = args;
  if (!isBilingualExportFilename(filename)) return null;
  const match = BILINGUAL_XPOINTER.exec(progress);
  if (!match) return null;
  const chapter = Number(match[1]);
  const paragraph = Number(match[2]);
  if (!Number.isInteger(chapter) || !Number.isInteger(paragraph)) return null;
  if (chapter < 1 || chapter > chapterBodyStarts.length || paragraph < 1) {
    return null;
  }
  const start = chapterBodyStarts[chapter - 1];
  if (start === undefined) return null;
  const end = chapterBodyStarts[chapter] ?? unitCount;
  const unit = start + paragraph - 1;
  return unit >= start && unit < end ? unit : null;
}

/**
 * Exact export XPointer for a body unit: the inverse of
 * `bilingualXPointerUnitIndex`. Title units have no `<p>`, so they return
 * null, as do units outside the book or in a chapterless book.
 *
 * `chapterUnitStarts` is the first Zen unit of each chapter including its
 * title; `chapterBodyStarts` is the first unit after that title. A unit is
 * body text only inside `[bodyStart, nextChapterTitleStart)`.
 */
export function bilingualXPointer(args: {
  index: number;
  chapterUnitStarts: readonly number[];
  chapterBodyStarts: readonly number[];
  unitCount: number;
}): string | null {
  const { index, chapterUnitStarts, chapterBodyStarts, unitCount } = args;
  if (!Number.isInteger(index) || index < 0 || index >= unitCount) return null;
  if (chapterUnitStarts.length === 0) return null;
  if (chapterUnitStarts.length !== chapterBodyStarts.length) return null;

  let chapter = -1;
  for (
    let candidate = 0;
    candidate < chapterUnitStarts.length;
    candidate += 1
  ) {
    if ((chapterUnitStarts[candidate] ?? 0) <= index) chapter = candidate;
    else break;
  }
  if (chapter < 0) return null;

  const bodyStart = chapterBodyStarts[chapter] ?? 0;
  const end = chapterUnitStarts[chapter + 1] ?? unitCount;
  if (index < bodyStart || index >= end) return null;

  const paragraph = index - bodyStart + 1;
  return `/body/DocFragment[${chapter + 1}]/body/p[${paragraph}]/br[1].0`;
}

export function shouldPromptKosync(args: {
  remote: KosyncProgress | null;
  offsets: UnitOffsets;
  localIndex: number;
  dismissed: KosyncDismissal | null;
  chapterBodyStarts: readonly number[];
}): KosyncPrompt | null {
  const { remote, offsets, localIndex, dismissed, chapterBodyStarts } = args;
  if (!remote || offsets.total <= 0) return null;
  if (remote.percentage < 0 || remote.percentage > 1) return null;
  if (
    dismissed &&
    dismissed.version === KOSYNC_MAPPING_VERSION &&
    dismissed.document === remote.document &&
    dismissed.updatedAt >= remote.updatedAt
  ) {
    return null;
  }

  const exactIndex = bilingualXPointerUnitIndex({
    progress: remote.progress,
    filename: remote.filename,
    chapterBodyStarts,
    unitCount: offsets.starts.length,
  });
  const index = exactIndex ?? unitIndexAtPercentage(offsets, remote.percentage);
  if (index === null) return null;

  if (exactIndex !== null) {
    // Exact, trustworthy target: allow a backward correction, but never a
    // no-op prompt.
    if (index === localIndex) return null;
  } else {
    if (index <= localIndex) return null;
    if (
      remote.percentage - unitStartPercentage(offsets, localIndex) <
      KOSYNC_PROMPT_MIN_AHEAD
    ) {
      return null;
    }
  }

  return {
    index,
    percentage: remote.percentage,
    device: remote.device,
    document: remote.document,
    updatedAt: remote.updatedAt,
  };
}

export function parseKosyncProgress(value: unknown): KosyncProgress | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.document !== "string" || row.document.length === 0) {
    return null;
  }
  if (typeof row.percentage !== "number" || !Number.isFinite(row.percentage)) {
    return null;
  }
  if (typeof row.progress !== "string") return null;
  if (typeof row.device !== "string") return null;
  if (typeof row.updatedAt !== "number" || !Number.isFinite(row.updatedAt)) {
    return null;
  }
  return {
    document: row.document,
    filename: typeof row.filename === "string" ? row.filename : null,
    percentage: Math.min(1, Math.max(0, row.percentage)),
    progress: row.progress,
    device: row.device.trim() || "KOReader",
    updatedAt: row.updatedAt,
    title: typeof row.title === "string" ? row.title : null,
    authors: typeof row.authors === "string" ? row.authors : null,
  };
}

const PUSH_REASONS: ReadonlySet<string> = new Set([
  "disabled",
  "unlinked",
  "not-exact",
  "stale",
]);

/** Strict parse: a success must carry the new base timestamp and document. */
export function parseKosyncPushResult(value: unknown): KosyncPushResult | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.pushed !== "boolean") return null;
  const reason =
    typeof row.reason === "string" && PUSH_REASONS.has(row.reason)
      ? (row.reason as KosyncPushReason)
      : undefined;
  const document = typeof row.document === "string" ? row.document : undefined;
  const updatedAt =
    typeof row.updatedAt === "number" && Number.isFinite(row.updatedAt)
      ? row.updatedAt
      : undefined;
  if (row.pushed && (document === undefined || updatedAt === undefined)) {
    return null;
  }
  return {
    pushed: row.pushed,
    ...(reason === undefined ? {} : { reason }),
    ...(document === undefined ? {} : { document }),
    ...(updatedAt === undefined ? {} : { updatedAt }),
  };
}

export function loadKosyncDismissal(
  storage: StorageLike,
  articleId: string,
): KosyncDismissal | null {
  try {
    const raw = storage.getItem(`${DISMISSED_PREFIX}${articleId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<KosyncDismissal>;
    if (
      typeof parsed.document !== "string" ||
      typeof parsed.updatedAt !== "number" ||
      !Number.isFinite(parsed.updatedAt)
    ) {
      return null;
    }
    return {
      document: parsed.document,
      updatedAt: parsed.updatedAt,
      version:
        typeof parsed.version === "number" && Number.isFinite(parsed.version)
          ? parsed.version
          : 0,
    };
  } catch {
    return null;
  }
}

export function saveKosyncDismissal(
  storage: StorageLike,
  articleId: string,
  dismissal: KosyncDismissal,
): void {
  try {
    storage.setItem(
      `${DISMISSED_PREFIX}${articleId}`,
      JSON.stringify(dismissal),
    );
  } catch {
    // Private mode or a full quota only costs a repeated prompt.
  }
}
