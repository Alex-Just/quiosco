import type { Location } from "react-router-dom";
import { MIN_ARTICLE_TEXT_CHARS } from "./article";
import {
  type PreprocessApplyState,
  runAddPagePreprocess,
} from "./runAddPagePreprocess";
import { shareBody } from "./share";
import { readPendingShare } from "./sharePayload";
import type { ArticleStore } from "./store";
import { isGarbageTitle } from "./titleQuality";
import type { Via } from "./types";
import { normalizeUrl } from "./url";

interface PrefillState {
  prefillText?: string;
  prefillTitle?: string;
  prefillUrl?: string;
  fromUrlShare?: boolean;
}

export interface SharePrefillFields {
  nextUrl: string;
  nextTitle: string;
  nextBody: string;
  fromUrlShare: boolean;
}

export interface PrefillHandlers {
  setUrl: (url: string) => void;
  setText: (text: string) => void;
  setTitle: (value: string | ((current: string) => string)) => void;
  setFetchedVia: (via: Via | null) => void;
  setCleanup: (cleanup: boolean) => void;
  setError: (message: string | null) => void;
  setPreprocessing: (busy: boolean) => void;
  setFetchDetail: (detail: string | null) => void;
  setFetchWarning: (message: string | null) => void;
}

export async function loadEditPrefill(
  store: ArticleStore,
  editId: string,
): Promise<{
  title: string;
  url: string;
  text: string;
  cleanup: boolean;
} | null> {
  const article = await store.get(editId);
  if (!article) return null;
  return {
    title: article.title,
    url: article.url ?? "",
    text: article.text,
    cleanup: article.cleanup !== false,
  };
}

export async function loadSharePrefill(
  locationState: Location["state"],
): Promise<SharePrefillFields> {
  const state = (locationState ?? null) as PrefillState | null;
  const payload = await readPendingShare();
  const nextUrl = state?.prefillUrl ?? payload?.url ?? "";
  const nextText = state?.prefillText ?? payload?.text ?? "";
  const nextTitle = state?.prefillTitle ?? payload?.title ?? "";
  // The body a share actually carries: a URL-only share may repeat the URL
  // (or just the page title) in the text field, which is not article text.
  // A URL-only share often repeats the URL (or the page title) in the
  // text field. That is not article text: trusting it would skip the
  // fetch and save the URL as the body.
  const nextBody = shareBody({
    text: nextText,
    title: nextTitle,
    url: nextUrl,
  });
  return {
    nextUrl,
    nextTitle,
    nextBody,
    fromUrlShare: Boolean(state?.fromUrlShare),
  };
}

function livePreprocessApply(
  live: () => boolean,
  edited: { current: boolean },
  handlers: PrefillHandlers,
): PreprocessApplyState {
  return {
    setText: (text) => {
      if (live() && !edited.current) handlers.setText(text);
    },
    setTitle: (value) => {
      if (live() && !edited.current) handlers.setTitle(value);
    },
    setFetchedVia: (via) => {
      if (live()) handlers.setFetchedVia(via);
    },
    setCleanup: (cleanup) => {
      if (live() && !edited.current) handlers.setCleanup(cleanup);
    },
    setError: (message) => {
      if (live()) handlers.setError(message);
    },
    setPreprocessing: (busy) => {
      if (live()) handlers.setPreprocessing(busy);
    },
    setFetchDetail: (detail) => {
      if (live()) handlers.setFetchDetail(detail);
    },
    setFetchWarning: (message) => {
      if (live()) handlers.setFetchWarning(message);
    },
  };
}

export function applySharePrefillFields(
  share: SharePrefillFields,
  edited: { current: boolean },
  handlers: PrefillHandlers,
): void {
  if (edited.current) return;
  // Chrome reader-mode shares put chrome-distiller:// in the title field.
  // Leave the field empty so save can derive a title from the cleaned body.
  handlers.setTitle(isGarbageTitle(share.nextTitle) ? "" : share.nextTitle);
  handlers.setUrl(share.nextUrl);
  handlers.setText(share.nextBody);
  if (share.fromUrlShare) handlers.setCleanup(false);
}

export async function preprocessShortShareIfNeeded(options: {
  share: SharePrefillFields;
  edited: { current: boolean };
  live: () => boolean;
  handlers: PrefillHandlers;
}): Promise<void> {
  if (!options.live() || options.edited.current) return;
  const canonical = normalizeUrl(options.share.nextUrl);
  if (
    !canonical ||
    options.share.nextBody.trim().length >= MIN_ARTICLE_TEXT_CHARS
  ) {
    return;
  }
  await runAddPagePreprocess({
    targetUrl: options.share.nextUrl,
    sharedTitle: options.share.nextTitle,
    edited: options.edited,
    apply: livePreprocessApply(options.live, options.edited, options.handlers),
  });
}
