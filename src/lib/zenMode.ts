/** Min vertical travel before a swipe changes Zen paragraph. */
export const ZEN_SWIPE_MIN_DISTANCE_PX = 36;
/** Ignore swipes that are mostly horizontal. */
export const ZEN_SWIPE_MAX_HORIZONTAL_RATIO = 1;

export function clampZenIndex(index: number, total: number): number {
  // Keep the index when the paragraph list is briefly empty (load/nav),
  // so a restore is not wiped to 0 before content arrives.
  if (total <= 0) return index;
  if (index < 0) return 0;
  if (index > total - 1) return total - 1;
  return index;
}

export function stepZenIndex(
  index: number,
  total: number,
  delta: -1 | 1,
): number {
  return clampZenIndex(index + delta, total);
}

/**
 * Swipe up (finger moves up) → next paragraph.
 * Swipe down → previous. Returns the current index when the gesture is weak.
 */
export function zenIndexAfterSwipe(args: {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  index: number;
  total: number;
}): number {
  const dx = args.endX - args.startX;
  const dy = args.endY - args.startY;
  if (Math.abs(dy) < ZEN_SWIPE_MIN_DISTANCE_PX) return args.index;
  if (Math.abs(dx) > Math.abs(dy) * ZEN_SWIPE_MAX_HORIZONTAL_RATIO) {
    return args.index;
  }
  const delta: -1 | 1 = dy < 0 ? 1 : -1;
  return stepZenIndex(args.index, args.total, delta);
}
