import { originalText } from "./article";
import { deriveTitle } from "./share";
import { isGarbageTitle } from "./titleQuality";
import type { Article } from "./types";

/**
 * If a stored title is a share artifact (Chrome reader-mode, raw URL, …),
 * return a replacement taken from the cleaned body. Returns null when no
 * repair is needed.
 */
export function repairGarbageTitle(article: Article): string | null {
  if (!isGarbageTitle(article.title)) return null;
  const next = deriveTitle({
    extractedTitle: null,
    sharedTitle: "",
    text: originalText(article),
    url: article.url,
  });
  if (!next || next === article.title || isGarbageTitle(next)) return null;
  return next;
}
