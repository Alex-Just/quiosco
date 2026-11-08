import type { BookSentenceUnit } from "./bookText";
import type { KosyncProgress } from "./types";

/**
 * KOReader sends a percentage of its own pagination, not a character offset.
 * Mapping it onto quiosco's sentence units is therefore approximate; the
 * prompt is an offer to jump, never an automatic move.
 *
 * Only forward jumps are offered, mirroring KOReader's default
 * `sync_backward = DISABLE`: re-reading on the PocketBook must not silently
 * pull quiosco backwards.
 */
export const KOSYNC_PROMPT_MIN_AHEAD = 0.002;

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
}

type StorageLike = Pick<Storage, "getItem" | "setItem">;

const DISMISSED_PREFIX = "quiosco.kosync.dismissed.";

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

export function shouldPromptKosync(args: {
  remote: KosyncProgress | null;
  offsets: UnitOffsets;
  localIndex: number;
  dismissed: KosyncDismissal | null;
}): KosyncPrompt | null {
  const { remote, offsets, localIndex, dismissed } = args;
  if (!remote || offsets.total <= 0) return null;
  if (remote.percentage < 0 || remote.percentage > 1) return null;
  if (
    dismissed &&
    dismissed.document === remote.document &&
    dismissed.updatedAt >= remote.updatedAt
  ) {
    return null;
  }

  const index = unitIndexAtPercentage(offsets, remote.percentage);
  if (index === null || index <= localIndex) return null;
  if (
    remote.percentage - unitStartPercentage(offsets, localIndex) <
    KOSYNC_PROMPT_MIN_AHEAD
  ) {
    return null;
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
    percentage: Math.min(1, Math.max(0, row.percentage)),
    progress: row.progress,
    device: row.device.trim() || "KOReader",
    updatedAt: row.updatedAt,
    title: typeof row.title === "string" ? row.title : null,
    authors: typeof row.authors === "string" ? row.authors : null,
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
    return { document: parsed.document, updatedAt: parsed.updatedAt };
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
