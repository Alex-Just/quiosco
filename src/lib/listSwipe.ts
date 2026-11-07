/** Width of the revealed quick action; keep in sync with --swipe-action-width. */
export const SWIPE_ACTION_WIDTH = 88;

/** Horizontal movement in px before a gesture counts as a row swipe. */
const SWIPE_THRESHOLD = 8;

/** Keeps a row between closed (0) and fully open (-actionWidth). */
export function clampSwipeOffset(
  offset: number,
  actionWidth = SWIPE_ACTION_WIDTH,
): number {
  return Math.min(0, Math.max(-actionWidth, offset));
}

/** Whether releasing at this offset leaves the quick action open. */
export function swipeShouldOpen(
  offset: number,
  actionWidth = SWIPE_ACTION_WIDTH,
): boolean {
  return offset <= -actionWidth / 2;
}

/** A swipe is horizontal and long enough; anything else stays scroll or tap. */
export function isHorizontalDrag(
  dx: number,
  dy: number,
  threshold = SWIPE_THRESHOLD,
): boolean {
  return Math.abs(dx) > threshold && Math.abs(dx) > Math.abs(dy);
}
