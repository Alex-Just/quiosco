import { MIN_ARTICLE_CHARS } from "./quality";

export interface JsonLdArticle {
  title: string | null;
  text: string;
}

/** Sentences per blank-line paragraph when JSON-LD ships one blob. */
const SENTENCES_PER_PARAGRAPH = 2;

const SENTENCE_BREAK = /(?<=[.!?…])\s+/;
const ARTICLE_TYPES = new Set([
  "NewsArticle",
  "Article",
  "ReportageNewsArticle",
]);

/**
 * Turn a single-block articleBody into blank-line paragraphs so the quality
 * gate and Zen paging see real structure.
 */
export function paragraphizePlainBody(text: string): string {
  const trimmed = text.replace(/\r\n/g, "\n").trim();
  if (!trimmed) return "";
  if (/\n\s*\n/.test(trimmed)) return trimmed;

  const sentences = trimmed
    .split(SENTENCE_BREAK)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
  if (sentences.length <= 1) return trimmed;

  const paragraphs: string[] = [];
  for (
    let index = 0;
    index < sentences.length;
    index += SENTENCES_PER_PARAGRAPH
  ) {
    paragraphs.push(
      sentences.slice(index, index + SENTENCES_PER_PARAGRAPH).join(" "),
    );
  }
  return paragraphs.join("\n\n");
}

function isArticleType(type: unknown): boolean {
  if (typeof type === "string") return ARTICLE_TYPES.has(type);
  if (Array.isArray(type))
    return type.some(
      (entry) => typeof entry === "string" && ARTICLE_TYPES.has(entry),
    );
  return false;
}

function collectNodes(value: unknown, out: Record<string, unknown>[]): void {
  if (Array.isArray(value)) {
    for (const entry of value) collectNodes(entry, out);
    return;
  }
  if (!value || typeof value !== "object") return;
  const node = value as Record<string, unknown>;
  out.push(node);
  if (node["@graph"] != null) collectNodes(node["@graph"], out);
}

function parseJsonLdScripts(html: string): Record<string, unknown>[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
  const nodes: Record<string, unknown>[] = [];
  for (const script of scripts) {
    const raw = script.textContent?.trim() ?? "";
    if (!raw) continue;
    try {
      collectNodes(JSON.parse(raw) as unknown, nodes);
    } catch {
      // Publishers sometimes ship trailing commas or HTML comments; skip.
    }
  }
  return nodes;
}

/**
 * Prefer schema.org NewsArticle.articleBody when publishers embed the full
 * story in JSON-LD (common on Vocento soft-paywall pages).
 */
export function extractJsonLdArticle(html: string): JsonLdArticle | null {
  let best: JsonLdArticle | null = null;
  for (const node of parseJsonLdScripts(html)) {
    if (!isArticleType(node["@type"])) continue;
    const body = node.articleBody;
    if (typeof body !== "string") continue;
    const text = paragraphizePlainBody(body);
    if (text.length < MIN_ARTICLE_CHARS) continue;
    if (best && text.length <= best.text.length) continue;
    const headline = node.headline;
    best = {
      title: typeof headline === "string" ? headline.trim() || null : null,
      text,
    };
  }
  return best;
}
