import type { NavigateFunction } from "react-router-dom";
import { originalText } from "./article";
import { joinTranslationBody } from "./articleDisplayHelpers";
import { loadSettings } from "./settings";
import type { ArticleStore } from "./store";
import {
  cancelTranslation,
  hasRunningTranslation,
  translateArticle,
} from "./translateArticle";
import type { Article } from "./types";

export async function toggleArticleRead(
  store: ArticleStore,
  article: Article,
  setArticle: (article: Article) => void,
): Promise<void> {
  setArticle(
    await store.update(article.id, {
      status: article.status === "read" ? "unread" : "read",
    }),
  );
}

export async function toggleArticleArchive(
  store: ArticleStore,
  article: Article,
  setArticle: (article: Article) => void,
): Promise<void> {
  setArticle(
    await store.update(article.id, {
      status: article.status === "archived" ? "unread" : "archived",
    }),
  );
}

/** Archive from the Zen reading screen, then return to the list like Delete. */
export async function archiveArticleAndLeave(
  store: ArticleStore,
  article: Article,
  setArticle: (article: Article) => void,
  navigate: NavigateFunction,
): Promise<void> {
  await toggleArticleArchive(store, article, setArticle);
  navigate("/");
}

export async function deleteArticle(
  store: ArticleStore,
  article: Article,
  navigate: NavigateFunction,
): Promise<void> {
  const confirmMessage =
    article.kind === "book" ? "Delete this book?" : "Delete this article?";
  if (!window.confirm(confirmMessage)) return;
  await store.remove(article.id);
  navigate("/");
}

export function cancelArticleTranslation(
  store: ArticleStore,
  article: Article,
  setArticle: (article: Article) => void,
): void {
  if (hasRunningTranslation(article.id)) {
    cancelTranslation(article.id);
    return;
  }
  // The run is not alive in this session (the app was closed or reloaded, or
  // another device started it): return the article to a resumable state
  // instead of waiting out the stale-run lease.
  void (async () => {
    setArticle(
      await store.update(article.id, {
        translationStatus: "pending",
        translationPhase: null,
        phaseStartedAt: null,
        partial: null,
        error: null,
      }),
    );
  })();
}

export async function retranslateArticle(
  store: ArticleStore,
  article: Article,
  setArticle: (article: Article) => void,
  navigate: NavigateFunction,
  setBusy: (busy: boolean) => void,
): Promise<void> {
  const settings = loadSettings();
  if (!settings.appToken) {
    navigate("/settings");
    return;
  }
  setBusy(true);
  try {
    // A finished translation is re-run from scratch (the target language or
    // rules may have changed); partial/error states resume from the stored
    // position.
    const done = article.translationStatus === "done";
    const fresh = await store.update(article.id, {
      translationStatus: "pending",
      error: null,
      ...(done
        ? { translation: null, translatedChunks: 0, totalChunks: 0 }
        : {}),
    });
    setArticle(fresh);
    await translateArticle(store, fresh, settings);
    const reloaded = await store.get(article.id);
    if (reloaded) setArticle(reloaded);
  } finally {
    setBusy(false);
  }
}

export async function copyArticleText(
  article: Article,
  kind: "translation" | "original",
  setCopied: (kind: "translation" | "original") => void,
  resetCopied: () => void,
  resetDelayMs: number,
): Promise<void> {
  const value =
    kind === "translation"
      ? joinTranslationBody(article)
      : originalText(article);
  if (!value) return;
  await navigator.clipboard.writeText(value);
  setCopied(kind);
  window.setTimeout(resetCopied, resetDelayMs);
}
