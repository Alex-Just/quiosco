import type { NavigateFunction } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { makeArchiveAndLeave } from "./articleActionHandlers";
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

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("makeArchiveAndLeave", () => {
  it("does nothing when there is no store", () => {
    const navigate = vi.fn();
    expect(() =>
      makeArchiveAndLeave(
        null,
        article(),
        vi.fn(),
        navigate as unknown as NavigateFunction,
      )(),
    ).not.toThrow();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("archives the article and returns to the list", async () => {
    const updated: Array<Partial<Article>> = [];
    const navigate = vi.fn();
    makeArchiveAndLeave(
      fakeStore(updated),
      article(),
      vi.fn(),
      navigate as unknown as NavigateFunction,
    )();

    await flush();

    expect(updated).toEqual([{ status: "archived" }]);
    expect(navigate).toHaveBeenCalledWith("/");
  });
});
