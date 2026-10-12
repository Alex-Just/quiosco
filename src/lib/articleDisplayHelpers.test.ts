import { describe, expect, it } from "vitest";
import { newArticle, newBook } from "./article";
import { bodyParagraphs, listSource } from "./articleDisplayHelpers";

describe("bodyParagraphs", () => {
  it("keeps number and body together when a blank line sits between them", () => {
    const body = [
      "1",
      "",
      "🇪🇸 Guerra en Europa",
      "🇷🇺 Война в Европе",
      "",
      "2",
      "",
      "🇪🇸 Trump afirma que Rusia y Ucrania podrían llegar a un acuerdo.",
    ].join("\n");

    expect(bodyParagraphs(body)).toEqual([
      "1\n🇪🇸 Guerra en Europa\n🇷🇺 Война в Европе",
      "2\n🇪🇸 Trump afirma que Rusia y Ucrania podrían llegar a un acuerdo.",
    ]);
  });

  it("leaves already-glued numbered paragraphs unchanged", () => {
    const body = [
      "11\n🇪🇸 Incluso podrán superarse los 250/300.",
      "",
      "12\n🇪🇸 La Agencia Estatal de Meteorología.",
    ].join("\n");

    expect(bodyParagraphs(body)).toEqual([
      "11\n🇪🇸 Incluso podrán superarse los 250/300.",
      "12\n🇪🇸 La Agencia Estatal de Meteorología.",
    ]);
  });

  it("does not glue a year-like paragraph into the next block", () => {
    expect(bodyParagraphs("2026\n\nFue un año récord.")).toEqual([
      "2026",
      "Fue un año récord.",
    ]);
  });
});

describe("listSource", () => {
  const chapters = [{ title: "Uno", text: "Texto." }];

  it("shows the author for a book", () => {
    const book = newBook({
      title: "El principito",
      author: "Antoine de Saint-Exupéry",
      language: "es",
      chapters,
    });
    expect(listSource(book)).toBe("Antoine de Saint-Exupéry");
  });

  it("falls back to book for a book without an author", () => {
    const book = newBook({
      title: "Anónimo",
      author: null,
      language: null,
      chapters,
    });
    expect(listSource(book)).toBe("book");
  });

  it("shows the site for an article", () => {
    const article = newArticle({
      url: "https://example.com/noticia",
      title: "T",
      text: "Texto suficientemente largo para una noticia.",
      via: "manual",
    });
    expect(listSource(article)).toBe("example.com");
  });

  it("falls back to manual for an article without a site", () => {
    const article = newArticle({
      url: null,
      title: "T",
      text: "Texto suficientemente largo para una noticia.",
      via: "manual",
    });
    expect(listSource(article)).toBe("manual");
  });
});
