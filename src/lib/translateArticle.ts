import { createApi } from "./api";
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
    await store.update(article.id, {
      translationStatus: "running",
      error: null,
    });
    const { translation, totalChunks } = await runTranslation({
      text: article.text,
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
