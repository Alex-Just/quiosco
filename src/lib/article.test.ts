import { describe, expect, it } from "vitest";
import { newArticle, newBook, originalText } from "./article";
import type { BookChapter } from "./types";

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

describe("newBook", () => {
  const chapters: BookChapter[] = [
    { title: "Uno", text: "Primer capítulo." },
    { title: "Dos", text: "Segundo capítulo." },
  ];

  it("creates a pending book with no URL, site, text, or cleanup", () => {
    const book = newBook({
      title: "El principito",
      author: "Antoine de Saint-Exupéry",
      language: "es",
      chapters,
    });
    expect(book).toMatchObject({
      kind: "book",
      title: "El principito",
      author: "Antoine de Saint-Exupéry",
      bookLanguage: "es",
      text: "",
      url: null,
      site: null,
      via: "manual",
      cleanup: false,
      translation: null,
      partial: null,
      cleanText: null,
      translationStatus: "pending",
      translatedChunks: 0,
      totalChunks: 0,
      model: null,
      status: "unread",
      error: null,
    });
    expect(book.id).toBeTruthy();
    expect(book.createdAt).toBe(book.updatedAt);
  });

  it("keeps the given chapters and null metadata as-is", () => {
    const book = newBook({
      title: "Sin autor",
      author: null,
      language: null,
      chapters,
    });
    expect(book.chapters).toBe(chapters);
    expect(book.author).toBeNull();
    expect(book.bookLanguage).toBeNull();
  });

  it("falls back to Untitled for an empty title", () => {
    const book = newBook({
      title: "   ",
      author: null,
      language: null,
      chapters,
    });
    expect(book.title).toBe("Untitled");
  });

  it("falls back to Untitled for an empty title with null metadata", () => {
    const book = newBook({
      title: "",
      author: null,
      language: null,
      chapters,
    });
    expect(book.title).toBe("Untitled");
    expect(book.updatedAt).toBe(book.createdAt);
  });
});
