import { Readability } from "@mozilla/readability";

export interface ExtractedArticle {
  title: string | null;
  text: string;
}

const META_CHARSET_RE = /<meta[^>]+charset=["']?\s*([\w-]+)/i;
const CONTENT_TYPE_CHARSET_RE = /charset=["']?\s*([\w-]+)/i;

export function charsetFromContentType(
  contentType: string | null,
): string | null {
  if (!contentType) return null;
  return CONTENT_TYPE_CHARSET_RE.exec(contentType)?.[1]?.toLowerCase() ?? null;
}

export function decodeHtml(
  bytes: Uint8Array,
  contentType: string | null,
): string {
  let charset = charsetFromContentType(contentType);
  if (!charset) {
    const head = new TextDecoder("windows-1252").decode(
      bytes.subarray(0, 2048),
    );
    charset = META_CHARSET_RE.exec(head)?.[1]?.toLowerCase() ?? "utf-8";
  }
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

export function extractArticle(html: string): ExtractedArticle | null {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const parsed = new Readability(doc).parse();
  if (parsed) {
    const text = blocksToText(parsed.content ?? "");
    if (text.trim().length > 0)
      return { title: parsed.title?.trim() || null, text };
  }
  const body = doc.body?.textContent ?? "";
  if (body.trim().length > 0)
    return { title: doc.title.trim() || null, text: body };
  return null;
}

// Real news pages are minified, so Readability's textContent has no line
// breaks between block elements. Join block elements with blank lines so
// paragraph-aware consumers (quality gate, chunker, translation) see the
// article's paragraph structure.
function blocksToText(contentHtml: string): string {
  const container = new DOMParser().parseFromString(contentHtml, "text/html");
  const blocks = container.querySelectorAll(
    "p, h2, h3, h4, h5, h6, li, blockquote, pre, figcaption, td",
  );
  if (blocks.length === 0) return container.body?.textContent?.trim() ?? "";
  return Array.from(blocks)
    .map((block) => block.textContent?.replace(/\s+/g, " ").trim() ?? "")
    .filter((text) => text.length > 0)
    .join("\n\n");
}
