import type { NavigateFunction } from "react-router-dom";
import {
  archiveArticleAndLeave,
  cancelArticleTranslation,
  copyArticleText,
  deleteArticle,
  retranslateArticle,
  toggleArticleArchive,
  toggleArticleRead,
} from "./articleActions";
import type { ArticleStore } from "./store";
import type { Article } from "./types";

const COPY_RESET_MS = 1500;

export function makeToggleRead(
  store: ArticleStore | null,
  article: Article | null,
  setArticle: (article: Article) => void,
): () => void {
  return () => {
    if (store && article) void toggleArticleRead(store, article, setArticle);
  };
}

export function makeToggleArchive(
  store: ArticleStore | null,
  article: Article | null,
  setArticle: (article: Article) => void,
): () => void {
  return () => {
    if (store && article) {
      void toggleArticleArchive(store, article, setArticle);
    }
  };
}

export function makeOnDelete(
  store: ArticleStore | null,
  article: Article | null,
  navigate: NavigateFunction,
): () => void {
  return () => {
    if (store && article) void deleteArticle(store, article, navigate);
  };
}

export function makeArchiveAndLeave(
  store: ArticleStore | null,
  article: Article | null,
  setArticle: (article: Article) => void,
  navigate: NavigateFunction,
): () => void {
  return () => {
    if (store && article) {
      void archiveArticleAndLeave(store, article, setArticle, navigate);
    }
  };
}

export function makeOnCancel(
  store: ArticleStore | null,
  article: Article | null,
  setArticle: (article: Article) => void,
): () => void {
  return () => {
    if (store && article) {
      cancelArticleTranslation(store, article, setArticle);
    }
  };
}

type RetranslateHandlerDeps = {
  store: ArticleStore | null;
  article: Article | null;
  setArticle: (article: Article) => void;
  navigate: NavigateFunction;
  busy: boolean;
  setBusy: (busy: boolean) => void;
};

export function makeOnRetranslate(deps: RetranslateHandlerDeps): () => void {
  return () => {
    const { store, article, setArticle, navigate, busy, setBusy } = deps;
    if (store && article && !busy) {
      void retranslateArticle(store, article, setArticle, navigate, setBusy);
    }
  };
}

export function makeCopy(
  article: Article | null,
  setCopied: (kind: "none" | "translation" | "original") => void,
): (kind: "translation" | "original") => void {
  return (kind) => {
    if (article) {
      void copyArticleText(
        article,
        kind,
        setCopied,
        () => setCopied("none"),
        COPY_RESET_MS,
      );
    }
  };
}
