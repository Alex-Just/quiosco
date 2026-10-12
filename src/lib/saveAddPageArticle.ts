import { createApi } from "./api";
import {
  MAX_ARTICLE_CHARS,
  MIN_ARTICLE_TEXT_CHARS,
  newArticle,
} from "./article";
import { cleanArticleText } from "./clean";
import { preprocessUrlArticle } from "./preprocessUrl";
import { resolveArticleTitle } from "./resolveArticleTitle";
import { loadSettings } from "./settings";
import { clearPendingShare } from "./sharePayload";
import type { ArticleStore } from "./store";
import { extractTitleWithLlm } from "./titleWithLlm";
import type { Article, Settings, Via } from "./types";
import { normalizeUrl } from "./url";

export type SaveAddPageResult =
  | { kind: "duplicate"; articleId: string }
  | { kind: "needs-token" }
  | { kind: "validation"; message: string }
  | {
      kind: "saved";
      articleId: string;
      startTranslation?: { article: Article; settings: Settings };
    };

export interface SaveAddPageInput {
  store: ArticleStore;
  editId: string | null;
  title: string;
  url: string;
  text: string;
  cleanup: boolean;
  fetchedVia: Via | null;
  onFetchDetail: (detail: string | null) => void;
  onPreprocessApplied: (patch: {
    text: string;
    cleanup: boolean;
    via: Via;
  }) => void;
}

function translationResetPatch(
  textChanged: boolean,
  cleanupChanged: boolean,
): Partial<Article> | undefined {
  if (!textChanged && !cleanupChanged) return undefined;
  return {
    translation: null,
    partial: null,
    translationStatus: "pending",
    translatedChunks: 0,
    totalChunks: 0,
    cleanText: null,
    translationPhase: null,
    phaseStartedAt: null,
    cleanDurationMs: null,
    translateDurationMs: null,
    error: null,
  };
}

async function resolveSourceText(
  input: SaveAddPageInput,
  settings: Settings,
  canonical: string | null,
): Promise<
  | {
      source: string;
      extractedTitle: string | null;
      via: Via;
      cleanupChoice: boolean;
    }
  | { kind: "needs-token" }
> {
  let source = input.text;
  let extractedTitle: string | null = null;
  let via: Via = input.fetchedVia ?? "manual";
  let cleanupChoice = input.cleanup;
  const needsFetch =
    !input.editId &&
    source.trim().length < MIN_ARTICLE_TEXT_CHARS &&
    Boolean(canonical);
  if (!needsFetch) {
    return { source, extractedTitle, via, cleanupChoice };
  }
  if (!settings.appToken) return { kind: "needs-token" };
  if (!canonical) return { source, extractedTitle, via, cleanupChoice };
  const api = createApi({ token: settings.appToken });
  const result = await preprocessUrlArticle(canonical, api, {
    sharedTitle: input.title,
    onDetail: input.onFetchDetail,
  });
  source = result.text;
  extractedTitle = result.title;
  via = result.via;
  cleanupChoice = result.needsCleanup;
  input.onPreprocessApplied({ text: source, cleanup: cleanupChoice, via });
  return { source, extractedTitle, via, cleanupChoice };
}

function cleanedBody(
  source: string,
  cleanupChoice: boolean,
  via: Via,
  title: string,
): string {
  if (cleanupChoice && via === "manual") {
    return cleanArticleText(source, title);
  }
  return source.trim();
}

async function guessTitle(
  clipped: string,
  title: string,
  extractedTitle: string | null,
  url: string | null,
  settings: Settings,
): Promise<string> {
  const guessWithLlm = settings.appToken
    ? async (body: string) => {
        const api = createApi({ token: settings.appToken });
        return extractTitleWithLlm(body, settings.model, (request) =>
          api.translate(request),
        );
      }
    : undefined;
  return resolveArticleTitle({
    title,
    extractedTitle,
    body: clipped,
    url,
    guessWithLlm,
  });
}

async function saveExistingArticle(patch: {
  store: ArticleStore;
  editId: string;
  finalTitle: string;
  url: string;
  clipped: string;
  cleanupChoice: boolean;
}): Promise<SaveAddPageResult> {
  const existing = await patch.store.get(patch.editId);
  const textChanged = !existing || existing.text !== patch.clipped;
  const cleanupChanged =
    !existing || (existing.cleanup !== false) !== patch.cleanupChoice;
  await patch.store.update(patch.editId, {
    title: patch.finalTitle || "Untitled",
    url: normalizeUrl(patch.url),
    text: patch.clipped,
    cleanup: patch.cleanupChoice,
    ...translationResetPatch(textChanged, cleanupChanged),
  });
  await clearPendingShare();
  return { kind: "saved", articleId: patch.editId };
}

async function saveNewArticle(patch: {
  store: ArticleStore;
  canonical: string | null;
  finalTitle: string;
  clipped: string;
  via: Via;
  cleanupChoice: boolean;
  settings: Settings;
}): Promise<SaveAddPageResult> {
  const article = newArticle({
    url: patch.canonical,
    title: patch.finalTitle,
    text: patch.clipped,
    via: patch.via,
    cleanup: patch.cleanupChoice,
  });
  await patch.store.put(article);
  if (patch.settings.autoTranslate && patch.settings.appToken) {
    await patch.store.update(article.id, { translationStatus: "running" });
  }
  await clearPendingShare();
  const startTranslation =
    patch.settings.autoTranslate && patch.settings.appToken
      ? { article, settings: patch.settings }
      : undefined;
  return { kind: "saved", articleId: article.id, startTranslation };
}

export async function saveAddPageArticle(
  input: SaveAddPageInput,
): Promise<SaveAddPageResult> {
  const settings = loadSettings();
  const canonical = normalizeUrl(input.url);
  if (!input.editId && canonical) {
    const existing = await input.store.findByUrl(canonical);
    if (existing) {
      await clearPendingShare();
      return { kind: "duplicate", articleId: existing.id };
    }
  }
  const resolved = await resolveSourceText(input, settings, canonical);
  if ("kind" in resolved) return resolved;
  const { source, extractedTitle, via, cleanupChoice } = resolved;
  const cleaned = cleanedBody(source, cleanupChoice, via, input.title);
  if (cleaned.length < MIN_ARTICLE_TEXT_CHARS) {
    return {
      kind: "validation",
      message: canonical
        ? "Could not read that URL. Paste the article text instead."
        : "Paste the article text first (at least a paragraph).",
    };
  }
  const clipped = cleaned.slice(0, MAX_ARTICLE_CHARS);
  const finalTitle = await guessTitle(
    clipped,
    input.title,
    extractedTitle,
    canonical,
    settings,
  );
  if (input.editId) {
    return saveExistingArticle({
      store: input.store,
      editId: input.editId,
      finalTitle,
      url: input.url,
      clipped,
      cleanupChoice,
    });
  }
  return saveNewArticle({
    store: input.store,
    canonical,
    finalTitle,
    clipped,
    via,
    cleanupChoice,
    settings,
  });
}
