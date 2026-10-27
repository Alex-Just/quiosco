import { describe, expect, it } from "vitest";
import { articleChromeCompact, articleZenAvailable } from "./articleChrome";
import type { Article } from "./types";

const FIRST_PAGE = "First translated page with enough text to read.";

const article = (patch: Partial<Article> = {}): Article =>
  ({
    id: "a",
    title: "T",
    text: "x",
    translationStatus: "done",
    translation: FIRST_PAGE,
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

describe("articleZenAvailable", () => {
  it("opens Zen after the first committed translation paragraph", () => {
    expect(
      articleZenAvailable(
        article({
          translationStatus: "running",
          translation: FIRST_PAGE,
          translatedChunks: 1,
          totalChunks: 4,
        }),
      ),
    ).toBe(true);
  });

  it("waits for a committed paragraph; partial alone is not enough", () => {
    expect(
      articleZenAvailable(
        article({
          translationStatus: "running",
          translation: "",
          partial: "Streaming first chunk…",
          translatedChunks: 0,
          totalChunks: 4,
        }),
      ),
    ).toBe(false);
  });

  it("stays available when translation is done or stopped with pages", () => {
    expect(articleZenAvailable(article())).toBe(true);
    expect(
      articleZenAvailable(
        article({
          translationStatus: "error",
          translation: FIRST_PAGE,
          translatedChunks: 1,
          totalChunks: 4,
        }),
      ),
    ).toBe(true);
  });

  it("stays closed when there is no translation yet", () => {
    expect(
      articleZenAvailable(
        article({
          translationStatus: "pending",
          translation: "",
          translatedChunks: 0,
          totalChunks: 0,
        }),
      ),
    ).toBe(false);
  });
});
