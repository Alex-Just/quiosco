import { chunkText } from "./chunk";
import { cleanArticleText } from "./clean";

// Large inputs are cleaned in segments so each model response stays small
// enough to avoid output-token truncation on the smaller allowlisted models.
const CLEANUP_CHUNK_CHARS = 12_000;

export const CLEANUP_SYSTEM_PROMPT = `You extract the main content from raw web page text. The text you receive is the raw content of a web page: navigation menus, cookie/consent notices, subscription prompts, advertisements, related-article lists, comments, and footers may be mixed with an article.

Return ONLY the main article, verbatim, in its original language:
- Keep the headline, standfirst/subtitle, byline, and every paragraph of the article body, complete and in order.
- Remove everything that is not part of the article: menus, breadcrumbs, cookie banners, consent text, "subscribe" prompts, ads, share buttons, related links, comment sections, footers, newsletter boxes, tickers.
- Do not summarize, shorten, reword, translate, or comment. Do not add headings of your own.
- Do not use markdown syntax: output plain text without "#", links, or image markers.
- If the headline or any text appears more than once (for example a metadata block and the article heading), keep only one copy.
- Output the cleaned article text only, preserving paragraph breaks.`;

export interface CleanupResult {
  text: string;
  cleaned: boolean;
}

export async function cleanWithLlm(
  text: string,
  model: string,
  translate: (request: {
    model: string;
    system: string;
    text: string;
  }) => Promise<string>,
): Promise<CleanupResult> {
  const segments = chunkText(text, CLEANUP_CHUNK_CHARS);
  const cleanedSegments: string[] = [];
  let allSucceeded = true;
  for (const segment of segments) {
    let cleaned = "";
    try {
      cleaned = (
        await translate({ model, system: CLEANUP_SYSTEM_PROMPT, text: segment })
      ).trim();
    } catch {
      cleaned = "";
    }
    if (cleaned.length === 0) allSucceeded = false;
    cleanedSegments.push(cleaned.length > 0 ? cleaned : segment);
  }
  const joined = cleanedSegments.join("\n\n").trim();
  // Syntax pass: strip any markdown artifacts the model left behind.
  const result = cleanArticleText(joined).trim();
  return {
    text: result.length > 0 ? result : text,
    cleaned: allSucceeded && result.length > 0,
  };
}
