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

export async function translateArticle(
  store: ArticleStore,
  article: Article,
  settings: Settings,
): Promise<void> {
  const controller = new AbortController();
  inflight.set(article.id, controller);
  const api = createApi({ token: settings.appToken });
  try {
    const cleanup = article.cleanup !== false;
    await store.update(article.id, {
      translationStatus: "running",
      translationPhase: cleanup ? "cleaning" : "translating",
      model: settings.model,
      totalChunks: 0,
      partial: null,
      error: null,
    });
    let source = article.text;
    if (cleanup) {
      const cached = article.cleanText ?? null;
      if (cached) {
        source = cached;
      } else {
        const result = await cleanWithLlm(
          article.text,
          settings.model,
          (request) => api.translate(request, controller.signal),
          article.title,
          controller.signal,
        );
        source = result.text;
        if (result.cleaned)
          await store.update(article.id, { cleanText: source });
      }
    }
    await store.update(article.id, {
      translationPhase: "translating",
      totalChunks: chunkText(source).length,
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
    await store.update(article.id, {
      translation,
      translationStatus: "done",
      error: null,
      totalChunks,
      partial: null,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      // User-initiated cancel: keep the partial translation and return to a
      // resumable state instead of an error.
      await store.update(article.id, {
        translationStatus: "pending",
        translationPhase: null,
        error: null,
        partial: null,
      });
    } else {
      await store.update(article.id, {
        translationStatus: "error",
        error: error instanceof Error ? error.message : "translation failed",
        partial: null,
      });
    }
  } finally {
    if (inflight.get(article.id) === controller) inflight.delete(article.id);
  }
}
