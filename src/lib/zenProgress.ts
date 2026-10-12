/** 1-based page label for the Zen progress chrome, e.g. "2/5". */
export function zenProgressLabel(index: number, total: number): string {
  if (total <= 0) return "";
  return `${index + 1}/${total}`;
}

/** Fraction of the article read at the given Zen paragraph (0..1). */
export function zenProgressRatio(index: number, total: number): number {
  if (total <= 0) return 0;
  return (index + 1) / total;
}

/** CSS width for the solid Zen progress fill. */
export function zenProgressPercent(index: number, total: number): string {
  return `${zenProgressRatio(index, total) * 100}%`;
}
