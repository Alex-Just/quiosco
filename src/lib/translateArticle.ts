import { createApi } from "./api";
import { chunkText } from "./chunk";
import { cleanWithLlm } from "./cleanWithLlm";
import type { ArticleStore } from "./store";
import { runTranslation } from "./translator";
import type { Article, Settings } from "./types";

export async function translateArticle(
  store: ArticleStore,
  article: Article,
  settings: Settings,
): Promise<void> {
  const api = createApi({ token: settings.appToken });
  try {
    const cleanup = article.cleanup !== false;
    await store.update(article.id, {
      translationStatus: "running",
      translationPhase: cleanup ? "cleaning" : "translating",
      totalChunks: 0,
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
          (request) => api.translate(request),
          article.title,
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
      translate: (request) => api.translate(request),
      existingTranslation: article.translation ?? undefined,
      translatedChunks: article.translatedChunks,
      onProgress: async (progress) => {
        await store.update(article.id, {
          translation: progress.translation,
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
    });
  } catch (error) {
    await store.update(article.id, {
      translationStatus: "error",
      error: error instanceof Error ? error.message : "translation failed",
    });
  }
}
