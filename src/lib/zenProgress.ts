/** 1-based page label for the Zen progress chrome, e.g. "2/5". */
export function zenProgressLabel(index: number, total: number): string {
  if (total <= 0) return "";
  return `${index + 1}/${total}`;
}

/** Segment `segmentIndex` is filled when the reader has reached that page. */
export function isZenProgressSegmentActive(
  segmentIndex: number,
  currentIndex: number,
): boolean {
  return segmentIndex <= currentIndex;
}
