import { chunkText } from "./chunk";
import { cleanArticleText } from "./clean";

// Large inputs are cleaned in segments so each model response stays small
// enough to avoid output-token truncation on the smaller allowlisted models.
// Segments are cleaned with bounded concurrency (they are independent) so a
// long article does not wait for minutes of sequential model calls.
const CLEANUP_CHUNK_CHARS = 12_000;
const CLEANUP_CONCURRENCY = 3;

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

export interface CleanWithLlmOptions {
  text: string;
  model: string;
  translate: (request: {
    model: string;
    system: string;
    text: string;
  }) => Promise<string>;
  title?: string;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}

export async function cleanWithLlm(
  options: CleanWithLlmOptions,
): Promise<CleanupResult> {
  const segments = chunkText(options.text, CLEANUP_CHUNK_CHARS);
  const { cleanedSegments, allSucceeded } = await cleanSegmentsConcurrently(
    segments,
    options,
  );
  const joined = cleanedSegments.join("\n\n").trim();
  // Syntax pass: strip any markdown artifacts the model left behind, then drop
  // duplicate copies of the headline (raw texts often repeat it in metadata).
  const result = dedupeTitle(cleanArticleText(joined).trim(), options.title);
  return {
    text: result.length > 0 ? result : options.text,
    cleaned: allSucceeded && result.length > 0,
  };
}

async function cleanSegmentsConcurrently(
  segments: string[],
  options: CleanWithLlmOptions,
): Promise<{ cleanedSegments: string[]; allSucceeded: boolean }> {
  const cleanedSegments = new Array<string>(segments.length).fill("");
  let allSucceeded = true;
  let done = 0;
  let next = 0;
  const worker = async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= segments.length) return;
      if (options.signal?.aborted) throw new Error("cleanup cancelled");
      const segment = segments[index] ?? "";
      const { cleaned, succeeded } = await cleanOneSegment(segment, options);
      if (!succeeded) allSucceeded = false;
      cleanedSegments[index] = cleaned.length > 0 ? cleaned : segment;
      done += 1;
      reportCleanupProgress(options.onProgress, done, segments.length);
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.min(CLEANUP_CONCURRENCY, segments.length) },
      worker,
    ),
  );
  return { cleanedSegments, allSucceeded };
}

async function cleanOneSegment(
  segment: string,
  options: CleanWithLlmOptions,
): Promise<{ cleaned: string; succeeded: boolean }> {
  try {
    const cleaned = (
      await options.translate({
        model: options.model,
        system: CLEANUP_SYSTEM_PROMPT,
        text: segment,
      })
    ).trim();
    return { cleaned, succeeded: cleaned.length > 0 };
  } catch {
    return { cleaned: "", succeeded: false };
  }
}

function reportCleanupProgress(
  onProgress: CleanWithLlmOptions["onProgress"],
  done: number,
  total: number,
): void {
  try {
    onProgress?.(done, total);
  } catch {
    // Progress reporting is best-effort.
  }
}

function dedupeTitle(text: string, title?: string): string {
  const needle = (title ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  if (needle.length < 10) return text;
  let seen = false;
  const blocks = text.split(/\n{2,}/).filter((block) => {
    const normalized = block.toLowerCase().replace(/\s+/g, " ").trim();
    if (normalized === needle) {
      if (seen) return false;
      seen = true;
    }
    return true;
  });
  return blocks.join("\n\n").trim();
}
