import type { NavigateFunction } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { archiveArticleAndLeave } from "./articleActions";
import type { ArticleStore } from "./store";
import type { Article } from "./types";

const article = (patch: Partial<Article> = {}): Article =>
  ({
    id: "a",
    url: null,
    title: "T",
    site: null,
    text: "x",
    via: "manual",
    translation: null,
    translationStatus: "done",
    translatedChunks: 1,
    totalChunks: 1,
    status: "unread",
    error: null,
    createdAt: 1,
    updatedAt: 1,
    ...patch,
  }) as Article;

function fakeStore(updated: Array<Partial<Article>>): ArticleStore {
  return {
    async update(_id: string, patch: Partial<Article>) {
      updated.push(patch);
      return { ...article(), ...patch };
    },
  } as unknown as ArticleStore;
}

describe("archiveArticleAndLeave", () => {
  it("archives the article and returns to the list", async () => {
    const updated: Array<Partial<Article>> = [];
    const setArticle = vi.fn();
    const navigate = vi.fn();

    await archiveArticleAndLeave(
      fakeStore(updated),
      article({ status: "unread" }),
      setArticle,
      navigate as unknown as NavigateFunction,
    );

    expect(updated).toEqual([{ status: "archived" }]);
    expect(setArticle).toHaveBeenCalledWith(
      expect.objectContaining({ status: "archived" }),
    );
    expect(navigate).toHaveBeenCalledWith("/");
  });
});
