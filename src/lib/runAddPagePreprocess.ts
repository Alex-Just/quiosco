import {
  preprocessErrorMessage,
  TOKEN_REQUIRED_FOR_URL,
} from "./addPageErrors";
import type { ApiClient } from "./api";
import { createApi } from "./api";
import { preprocessUrlArticle } from "./preprocessUrl";
import { loadSettings } from "./settings";
import type { Via } from "./types";
import { normalizeUrl } from "./url";

export interface PreprocessApplyState {
  setText: (text: string) => void;
  setTitle: (value: string | ((current: string) => string)) => void;
  setFetchedVia: (via: Via | null) => void;
  setCleanup: (cleanup: boolean) => void;
  setError: (message: string | null) => void;
  setPreprocessing: (busy: boolean) => void;
  setFetchDetail: (detail: string | null) => void;
}

export interface RunPreprocessOptions {
  targetUrl: string;
  sharedTitle: string;
  edited: { current: boolean };
  apply: PreprocessApplyState;
  api?: ApiClient;
}

export async function runAddPagePreprocess(
  options: RunPreprocessOptions,
): Promise<void> {
  const { targetUrl, sharedTitle, edited, apply } = options;
  const canonical = normalizeUrl(targetUrl);
  if (!canonical) return;
  const settings = loadSettings();
  if (!settings.appToken) {
    apply.setError(TOKEN_REQUIRED_FOR_URL);
    return;
  }
  apply.setPreprocessing(true);
  apply.setError(null);
  apply.setCleanup(false);
  apply.setFetchDetail("Fetching article…");
  try {
    const api = options.api ?? createApi({ token: settings.appToken });
    const result = await preprocessUrlArticle(canonical, api, {
      sharedTitle,
      onDetail: apply.setFetchDetail,
    });
    if (!edited.current) {
      apply.setText(result.text);
      apply.setTitle((current) => current.trim() || result.title);
      apply.setCleanup(result.needsCleanup);
    }
    apply.setFetchedVia(result.via);
  } catch (preprocessError) {
    apply.setError(preprocessErrorMessage(preprocessError));
    apply.setFetchedVia(null);
  } finally {
    apply.setPreprocessing(false);
    apply.setFetchDetail(null);
  }
}
