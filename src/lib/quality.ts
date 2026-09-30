export const MIN_ARTICLE_CHARS = 600;
export const MIN_PARAGRAPHS = 3;

export const PAYWALL_MARKERS = [
  "suscríbete para seguir leyendo",
  "para seguir leyendo este",
  "suscríbete para leer",
  "subscribe to continue reading",
  "to continue reading, subscribe",
  "create a free account to continue",
  "checking your browser",
  "just a moment...",
  "enable javascript and cookies to continue",
  "datadome",
  "you have reached your article limit",
];

export type QualityVerdict =
  | { ok: true }
  | { ok: false; reason: "too-short" | "too-few-paragraphs" | "marker" };

export function paragraphCount(text: string): number {
  return text
    .split(/\n+/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length >= 40).length;
}

export function assessArticle(text: string): QualityVerdict {
  const trimmed = text.trim();
  if (trimmed.length < MIN_ARTICLE_CHARS)
    return { ok: false, reason: "too-short" };
  const lower = trimmed.toLowerCase();
  for (const marker of PAYWALL_MARKERS) {
    if (lower.includes(marker)) return { ok: false, reason: "marker" };
  }
  if (paragraphCount(trimmed) < MIN_PARAGRAPHS)
    return { ok: false, reason: "too-few-paragraphs" };
  return { ok: true };
}
