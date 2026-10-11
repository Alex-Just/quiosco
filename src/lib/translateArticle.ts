import { createApi } from "./api";
import { chunkText } from "./chunk";
import { cleanWithLlm } from "./cleanWithLlm";
import type { ArticleStore } from "./store";
import { runTranslation } from "./translator";
import type { Article, Settings } from "./types";

const inflight = new Map<string, AbortController>();

export function cancelTranslation(articleId: string): void {
  inflight.get(articleId)?.abort();
}

export function isTranslationRunning(): boolean {
  return inflight.size > 0;
}

export function hasRunningTranslation(articleId: string): boolean {
  return inflight.has(articleId);
}

export async function translateArticle(
  store: ArticleStore,
  article: Article,
  settings: Settings,
): Promise<void> {
  const controller = new AbortController();
  inflight.set(article.id, controller);
  const api = createApi({ token: settings.appToken });
  try {
    const source = await resolveSourceText(
      store,
      article,
      settings,
      api,
      controller,
    );
    await runTranslationPhase({
      store,
      article,
      settings,
      api,
      controller,
      source,
    });
  } catch (error) {
    await persistTranslationFailure(store, article.id, controller, error);
  } finally {
    if (inflight.get(article.id) === controller) inflight.delete(article.id);
  }
}

async function resolveSourceText(
  store: ArticleStore,
  article: Article,
  settings: Settings,
  api: ReturnType<typeof createApi>,
  controller: AbortController,
): Promise<string> {
  const cleanup = article.cleanup !== false;
  const cached = cleanup ? (article.cleanText ?? null) : null;
  const needsClean = cleanup && !cached;
  const resetTranslateTiming = article.translatedChunks === 0;
  await store.update(article.id, {
    translationStatus: "running",
    translationPhase: needsClean ? "cleaning" : "translating",
    phaseStartedAt: Date.now(),
    model: settings.model,
    totalChunks: 0,
    partial: null,
    error: null,
    ...(needsClean ? { cleanDurationMs: null } : {}),
    ...(resetTranslateTiming ? { translateDurationMs: null } : {}),
  });
  if (needsClean) {
    return cleanSourceText(store, article, settings, api, controller);
  }
  return cached ?? article.text;
}

async function cleanSourceText(
  store: ArticleStore,
  article: Article,
  settings: Settings,
  api: ReturnType<typeof createApi>,
  controller: AbortController,
): Promise<string> {
  const cleanStartedAt = Date.now();
  const result = await cleanWithLlm({
    text: article.text,
    model: settings.model,
    // Streamed so a slow segment cannot hit the worker's non-stream
    // timeout and silently degrade to raw text.
    translate: (request) => api.translateStream(request, controller.signal),
    title: article.title,
    signal: controller.signal,
    onProgress: (done, total) => {
      void store
        .update(article.id, {
          translatedChunks: done,
          totalChunks: total,
        })
        .catch(() => undefined);
    },
  });
  const source = result.text;
  await store.update(article.id, {
    ...(result.cleaned ? { cleanText: source } : {}),
    cleanDurationMs: Date.now() - cleanStartedAt,
    translationPhase: "translating",
    phaseStartedAt: Date.now(),
  });
  return source;
}

async function runTranslationPhase(args: {
  store: ArticleStore;
  article: Article;
  settings: Settings;
  api: ReturnType<typeof createApi>;
  controller: AbortController;
  source: string;
}): Promise<void> {
  const { store, article, settings, api, controller, source } = args;
  const resetTranslateTiming = article.translatedChunks === 0;
  const translateStartedAt = Date.now();
  await store.update(article.id, {
    translationPhase: "translating",
    phaseStartedAt: translateStartedAt,
    totalChunks: chunkText(source).length,
    translatedChunks: article.translatedChunks,
  });
  const { translation, totalChunks } = await runTranslation({
    text: source,
    settings: {
      targetLanguage: settings.targetLanguage,
      rules: settings.rules,
      model: settings.model,
    },
    translate: (request, onDelta) =>
      api.translateStream(request, controller.signal, onDelta),
    existingTranslation: article.translation ?? undefined,
    translatedChunks: article.translatedChunks,
    signal: controller.signal,
    onProgress: async (progress) => {
      await store.update(article.id, {
        translation: progress.translation,
        partial: progress.partial ?? null,
        translatedChunks: progress.translatedChunks,
        totalChunks: progress.totalChunks,
      });
    },
  });
  const priorTranslateMs = resetTranslateTiming
    ? 0
    : (article.translateDurationMs ?? 0);
  await store.update(article.id, {
    translation,
    translationStatus: "done",
    translationPhase: null,
    error: null,
    totalChunks,
    partial: null,
    phaseStartedAt: null,
    translateDurationMs: priorTranslateMs + (Date.now() - translateStartedAt),
  });
}

async function persistTranslationFailure(
  store: ArticleStore,
  articleId: string,
  controller: AbortController,
  error: unknown,
): Promise<void> {
  if (controller.signal.aborted) {
    // User-initiated cancel: keep the partial translation and return to a
    // resumable state instead of an error.
    await store.update(articleId, {
      translationStatus: "pending",
      translationPhase: null,
      phaseStartedAt: null,
      error: null,
      partial: null,
    });
    return;
  }
  await store.update(articleId, {
    translationStatus: "error",
    translationPhase: null,
    phaseStartedAt: null,
    error: error instanceof Error ? error.message : "translation failed",
    partial: null,
  });
}
