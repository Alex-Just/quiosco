import { describe, expect, it } from "vitest";
import { articleChromeCollapsible } from "./articleChrome";
import type { Article } from "./types";

const article = (patch: Partial<Article> = {}): Article =>
  ({
    id: "a",
    title: "T",
    text: "x",
    translationStatus: "done",
    translatedChunks: 1,
    totalChunks: 1,
    status: "unread",
    via: "direct",
    createdAt: 1,
    updatedAt: 1,
    ...patch,
  }) as Article;

describe("articleChromeCollapsible", () => {
  it("collapses only when translation is done and idle", () => {
    expect(articleChromeCollapsible(article(), false)).toBe(true);
  });

  it("stays open while translating or when not done", () => {
    expect(articleChromeCollapsible(article(), true)).toBe(false);
    expect(
      articleChromeCollapsible(
        article({ translationStatus: "running" }),
        false,
      ),
    ).toBe(false);
    expect(
      articleChromeCollapsible(article({ translationStatus: "error" }), false),
    ).toBe(false);
    expect(
      articleChromeCollapsible(
        article({ translationStatus: "pending" }),
        false,
      ),
    ).toBe(false);
  });
});
