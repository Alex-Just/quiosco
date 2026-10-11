import { describe, expect, it } from "vitest";
import { newArticle, originalText } from "./article";

describe("originalText", () => {
  it("returns the raw text when no cleaned text is stored", () => {
    const article = newArticle({
      url: null,
      title: "T",
      text: "Raw noisy text with menus.",
      via: "manual",
    });
    expect(originalText(article)).toBe("Raw noisy text with menus.");
  });

  it("prefers cleaned text after cleanup has finished", () => {
    const article = {
      ...newArticle({
        url: null,
        title: "T",
        text: "Raw noisy text with menus.",
        via: "manual",
      }),
      cleanText: "Clean article body.",
    };
    expect(originalText(article)).toBe("Clean article body.");
  });
});
