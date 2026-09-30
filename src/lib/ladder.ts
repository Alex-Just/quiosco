import { decodeHtml, type ExtractedArticle, extractArticle } from "./extract";
import { assessArticle } from "./quality";
import type { Rung, RungResponse } from "./types";

export const LADDER_ORDER: Rung[] = [
  "direct",
  "googlebot",
  "jina",
  "wayback",
  "archive_ph",
];

export type FetchRung = (rung: Rung, url: string) => Promise<RungResponse>;

export interface LadderAttempt {
  rung: Rung;
  ok: boolean;
  reason?: string;
}

export interface LadderResult {
  article: ExtractedArticle;
  via: Rung;
  finalUrl: string | null;
  attempts: LadderAttempt[];
}

export class LadderError extends Error {
  constructor(
    readonly attempts: LadderAttempt[],
    readonly partialText: string | null,
  ) {
    super("All extraction rungs failed");
    this.name = "LadderError";
  }
}

function stripJinaFrontMatter(text: string): string {
  const marker = "Markdown Content:";
  const index = text.indexOf(marker);
  const body = index >= 0 ? text.slice(index + marker.length) : text;
  return body.trim();
}

export async function climbLadder(
  url: string,
  fetchRung: FetchRung,
): Promise<LadderResult> {
  const attempts: LadderAttempt[] = [];
  let partialText: string | null = null;

  for (const rung of LADDER_ORDER) {
    try {
      const response = await fetchRung(rung, url);
      const article: ExtractedArticle | null =
        response.kind === "markdown"
          ? {
              title: null,
              text: stripJinaFrontMatter(
                decodeHtml(
                  response.bytes,
                  response.contentType ?? "text/plain; charset=utf-8",
                ),
              ),
            }
          : extractArticle(decodeHtml(response.bytes, response.contentType));

      if (!article || article.text.trim().length === 0) {
        attempts.push({ rung, ok: false, reason: "no-content" });
        continue;
      }
      if (!partialText || article.text.length > partialText.length)
        partialText = article.text;

      const verdict = assessArticle(article.text);
      if (!verdict.ok) {
        attempts.push({ rung, ok: false, reason: verdict.reason });
        continue;
      }
      attempts.push({ rung, ok: true });
      return { article, via: rung, finalUrl: response.finalUrl, attempts };
    } catch (error) {
      attempts.push({
        rung,
        ok: false,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  throw new LadderError(attempts, partialText);
}
