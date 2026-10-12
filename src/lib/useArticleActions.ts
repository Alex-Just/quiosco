import { useState } from "react";
import type { NavigateFunction } from "react-router-dom";
import {
  makeArchiveAndLeave,
  makeCopy,
  makeOnCancel,
  makeOnDelete,
  makeOnRetranslate,
  makeToggleArchive,
  makeToggleRead,
} from "./articleActionHandlers";
import type { ArticleStore } from "./store";
import type { Article } from "./types";

export function useArticleActions(
  store: ArticleStore | null,
  article: Article | null,
  setArticle: (article: Article) => void,
  navigate: NavigateFunction,
): {
  busy: boolean;
  copied: "none" | "translation" | "original";
  toggleRead: () => void;
  toggleArchive: () => void;
  onArchiveAndLeave: () => void;
  onDelete: () => void;
  onCancel: () => void;
  onRetranslate: () => void;
  copy: (kind: "translation" | "original") => void;
} {
  const [copied, setCopied] = useState<"none" | "translation" | "original">(
    "none",
  );
  const [busy, setBusy] = useState(false);

  return {
    busy,
    copied,
    toggleRead: makeToggleRead(store, article, setArticle),
    toggleArchive: makeToggleArchive(store, article, setArticle),
    onArchiveAndLeave: makeArchiveAndLeave(
      store,
      article,
      setArticle,
      navigate,
    ),
    onDelete: makeOnDelete(store, article, navigate),
    onCancel: makeOnCancel(store, article, setArticle),
    onRetranslate: makeOnRetranslate({
      store,
      article,
      setArticle,
      navigate,
      busy,
      setBusy,
    }),
    copy: makeCopy(article, setCopied),
  };
}
