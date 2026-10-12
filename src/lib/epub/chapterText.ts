export interface ChapterContent {
  heading: string | null;
  paragraphs: string[];
}

// Elements whose text is never chapter prose.
const SKIP_TAGS = new Set(["script", "style", "head", "svg"]);
// Elements that start and end a paragraph.
const BLOCK_TAGS = new Set([
  "article",
  "aside",
  "blockquote",
  "div",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "li",
  "p",
  "section",
  "tr",
]);
const HEADING_TAGS = new Set(["h1", "h2", "h3"]);

const collapseWhitespace = (text: string) => text.replace(/\s+/g, " ");

/**
 * Paragraphs and heading of one EPUB chapter document. Text-first: markup is
 * dropped, block elements delimit paragraphs, and `<br>` becomes a newline
 * inside the paragraph, so drop caps built from nested spans stay glued.
 */
export function extractChapter(html: string): ChapterContent {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const paragraphs: string[] = [];
  let heading: string | null = null;
  let buffer = "";

  const flush = () => {
    // Trim each `<br>`-delimited line too, so indentation around a line
    // break in pretty-printed XHTML does not leak into the paragraph.
    const text = buffer
      .split("\n")
      .map((line) => line.trim())
      .join("\n")
      .trim();
    buffer = "";
    if (text) paragraphs.push(text);
  };

  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      buffer += collapseWhitespace(node.nodeValue ?? "");
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const element = node as Element;
    const tag = element.tagName.toLowerCase();
    if (SKIP_TAGS.has(tag)) return;
    if (tag === "br") {
      buffer += "\n";
      return;
    }
    const block = BLOCK_TAGS.has(tag);
    if (block) flush();
    // Paragraphs produced while inside the first h1–h3 are its text: they
    // already follow the buffer rules (skipped subtrees dropped, `<br>`
    // breaks lines), so the heading cannot glue words or leak markup.
    const headingStart = HEADING_TAGS.has(tag) ? paragraphs.length : -1;
    for (const child of Array.from(element.childNodes)) walk(child);
    if (block) flush();
    if (
      heading === null &&
      headingStart !== -1 &&
      paragraphs.length > headingStart
    ) {
      // A heading is a one-line title: its lines (from `<br>` or a nested
      // block) join back with single spaces.
      heading = collapseWhitespace(paragraphs.slice(headingStart).join(" "));
    }
  };

  if (doc.body) {
    for (const child of Array.from(doc.body.childNodes)) walk(child);
  }
  flush();
  return { heading, paragraphs };
}
