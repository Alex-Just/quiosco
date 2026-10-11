import { isGarbageTitle } from "./titleQuality";
import type { SharePayload } from "./types";

export const TEXT_MIN_CHARS = 400;

export type ShareClassification =
  | { mode: "url"; url: string; title: string }
  | { mode: "text"; text: string; title: string; url: string | null }
  | { mode: "manual"; text: string; title: string; url: string | null };

const URL_RE = /https?:\/\/[^\s<>"')\]]+/i;

export function firstUrl(text: string): string | null {
  const match = text.match(URL_RE);
  return match ? match[0] : null;
}

export function classifyShare(payload: SharePayload): ShareClassification {
  const text = payload.text.trim();
  const title = payload.title.trim();
  const url = payload.url.trim() || firstUrl(text) || "";

  if (!url) {
    if (text.length >= TEXT_MIN_CHARS)
      return { mode: "text", text, title, url: null };
    return { mode: "manual", text, title, url: null };
  }

  const remainder = text.split(url).join(" ").replace(/\s+/g, " ").trim();
  const remainderNoTitle = title && remainder === title ? "" : remainder;

  if (remainderNoTitle.length === 0) return { mode: "url", url, title };
  if (remainderNoTitle.length >= TEXT_MIN_CHARS) {
    return { mode: "text", text: remainderNoTitle, title, url };
  }
  return { mode: "manual", text: remainderNoTitle, title, url };
}

/**
 * The article body a share actually carries. Browsers often repeat the URL (or
 * only the page title) in the text field for a URL-only share; that is not
 * article text, so it must never be prefilled — saving it would skip the fetch
 * and store the URL as the article body.
 */
export function shareBody(input: {
  text: string;
  title: string;
  url: string;
}): string {
  const classification = classifyShare({ ...input, receivedAt: 0 });
  return classification.mode === "url" ? "" : classification.text;
}

export function deriveTitle(input: {
  extractedTitle: string | null;
  sharedTitle: string;
  text: string;
  url: string | null;
}): string {
  const extracted = input.extractedTitle?.trim();
  if (extracted && !isGarbageTitle(extracted)) return extracted.slice(0, 200);
  const shared = input.sharedTitle.trim();
  if (shared && !isGarbageTitle(shared)) return shared.slice(0, 200);
  const firstLine = input.text
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !isGarbageTitle(line));
  if (firstLine) return firstLine.slice(0, 200);
  if (input.url) {
    try {
      return new URL(input.url).hostname;
    } catch {
      /* fall through */
    }
  }
  return "Untitled";
}
