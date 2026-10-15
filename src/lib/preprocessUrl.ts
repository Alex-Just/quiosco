import type { ApiClient } from "./api";
import { climbLadder } from "./ladder";
import { suggestCleanup } from "./needsCleanup";
import { deriveTitle } from "./share";
import { parseTweetStatusUrl } from "./tweetUrl";
import type { Via } from "./types";
import { normalizeUrl } from "./url";

export interface PreprocessResult {
  text: string;
  title: string;
  via: Via;
  needsCleanup: boolean;
  partial?: boolean;
}

export async function preprocessUrlArticle(
  targetUrl: string,
  api: ApiClient,
  options: {
    sharedTitle?: string;
    onDetail?: (detail: string) => void;
  } = {},
): Promise<PreprocessResult> {
  const canonical = normalizeUrl(targetUrl);
  if (!canonical) throw new Error("invalid url");

  if (parseTweetStatusUrl(canonical)) {
    options.onDetail?.("Fetching thread…");
    const thread = await api.fetchThread(canonical);
    return {
      text: thread.text,
      title: deriveTitle({
        extractedTitle: thread.title,
        sharedTitle: options.sharedTitle ?? "",
        text: thread.text,
        url: canonical,
      }),
      via: "twitter",
      needsCleanup: false,
      partial: thread.partial,
    };
  }

  options.onDetail?.("Fetching article…");
  const result = await climbLadder(canonical, async (rung, url) => {
    options.onDetail?.(`Trying ${rung}…`);
    return api.fetchRung(rung, url);
  });

  options.onDetail?.("Checking whether cleanup is needed…");
  const needsCleanup = await suggestCleanup(result.article.text, (request) =>
    api.decide(request),
  );

  return {
    text: result.article.text,
    title: deriveTitle({
      extractedTitle: result.article.title,
      sharedTitle: options.sharedTitle ?? "",
      text: result.article.text,
      url: canonical,
    }),
    via: result.via,
    needsCleanup,
  };
}
