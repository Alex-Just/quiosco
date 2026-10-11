import { describe, expect, it } from "vitest";
import { articleChromeCompact } from "./articleChrome";
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

describe("articleChromeCompact", () => {
  it("uses compact chrome only when translation is done and idle", () => {
    expect(articleChromeCompact(article(), false)).toBe(true);
  });

  it("keeps full chrome while translating or when not done", () => {
    expect(articleChromeCompact(article(), true)).toBe(false);
    expect(
      articleChromeCompact(article({ translationStatus: "running" }), false),
    ).toBe(false);
    expect(
      articleChromeCompact(article({ translationStatus: "error" }), false),
    ).toBe(false);
    expect(
      articleChromeCompact(article({ translationStatus: "pending" }), false),
    ).toBe(false);
  });
});
