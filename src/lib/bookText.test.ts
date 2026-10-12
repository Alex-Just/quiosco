import { describe, expect, it } from "vitest";
import { newArticle } from "./article";
import {
  assembleTranslatedParagraph,
  bookChapterStarts,
  bookFlatParagraphs,
  bookSentenceUnits,
  MAX_BOOK_UNIT_CHARS,
  paragraphComplete,
  unitsByParagraph,
} from "./bookText";

const book = {
  ...newArticle({ url: null, title: "Libro", text: "", via: "manual" }),
  kind: "book" as const,
  chapters: [
    {
      title: "Capítulo uno",
      text: "Hola, mundo. ¿Qué tal?\n\nSegundo párrafo.",
    },
    { title: "Capítulo dos", text: "Otra cosa." },
  ],
};

describe("bookFlatParagraphs", () => {
  it("flattens chapters with the title first", () => {
    expect(bookFlatParagraphs(book)).toEqual([
      "Capítulo uno",
      "Hola, mundo. ¿Qué tal?",
      "Segundo párrafo.",
      "Capítulo dos",
      "Otra cosa.",
    ]);
  });

  it("reports the flat index of each chapter title", () => {
    expect(bookChapterStarts(book)).toEqual([0, 3]);
  });

  it("falls back to the article body when there are no chapters", () => {
    const article = newArticle({
      url: null,
      title: "Suelto",
      text: "Uno.\n\nDos.",
      via: "manual",
    });
    expect(bookFlatParagraphs(article)).toEqual(["Uno.", "Dos."]);
    expect(bookChapterStarts(article)).toEqual([]);
  });
});

describe("bookSentenceUnits", () => {
  it("strips sentence markers and marks letterless units as skipped", () => {
    expect(bookSentenceUnits(["12", "1. Texto."])).toEqual([
      { paragraphIndex: 0, text: "12", skipped: true },
      { paragraphIndex: 1, text: "1.", skipped: true },
      { paragraphIndex: 1, text: "Texto.", skipped: false },
    ]);
  });

  it("splits each sentence of a paragraph into its own unit", () => {
    expect(bookSentenceUnits(["Hola, mundo. ¿Qué tal?"])).toEqual([
      { paragraphIndex: 0, text: "Hola, mundo.", skipped: false },
      { paragraphIndex: 0, text: "¿Qué tal?", skipped: false },
    ]);
  });

  it("keeps paragraph indices aligned when a paragraph is empty", () => {
    expect(bookSentenceUnits(["", "Uno."])).toEqual([
      { paragraphIndex: 1, text: "Uno.", skipped: false },
    ]);
  });

  it("splits an oversized sentence at the last whitespace inside the cap", () => {
    const sentence = "palabra ".repeat(1000);
    const units = bookSentenceUnits([sentence]);
    const trimmed = sentence.trim();
    expect(trimmed.length).toBeGreaterThan(MAX_BOOK_UNIT_CHARS);
    expect(units.length).toBeGreaterThan(1);
    expect(units.every((unit) => unit.text.length <= MAX_BOOK_UNIT_CHARS)).toBe(
      true,
    );
    const cap = trimmed.slice(0, MAX_BOOK_UNIT_CHARS);
    const cut = cap.search(/\s\S*$/);
    expect(cut).toBeGreaterThan(0);
    expect(units.map((unit) => unit.text)).toEqual([
      trimmed.slice(0, cut),
      trimmed.slice(cut + 1),
    ]);
    expect(units.map((unit) => unit.text).join(" ")).toBe(trimmed);
  });

  it("hard-cuts an oversized sentence with no whitespace inside the cap", () => {
    const sentence = "a".repeat(MAX_BOOK_UNIT_CHARS + 100);
    expect(bookSentenceUnits([sentence]).map((unit) => unit.text)).toEqual([
      "a".repeat(MAX_BOOK_UNIT_CHARS),
      "a".repeat(100),
    ]);
  });
});

describe("unitsByParagraph", () => {
  it("groups unit indices by paragraph in order", () => {
    const grouped = unitsByParagraph(
      bookSentenceUnits(["Uno. Dos.", "Tres.", "Cuatro."]),
    );
    expect(grouped.get(0)).toEqual([0, 1]);
    expect(grouped.get(1)).toEqual([2]);
    expect(grouped.get(2)).toEqual([3]);
    expect(grouped.size).toBe(3);
  });
});

describe("assembleTranslatedParagraph", () => {
  it("uses translations per unit and falls back to the source", () => {
    const units = bookSentenceUnits(["Hola, mundo. ¿Qué tal?"]);
    const result = assembleTranslatedParagraph(
      units,
      [0, 1],
      new Map([[0, "Hello, world."]]),
    );
    expect(result).toContain("Hello, world.");
    expect(result).toContain("¿Qué tal?");
    expect(result).toBe("Hello, world. ¿Qué tal?");
  });

  it("separates a flag-led translation from the previous part", () => {
    const units = bookSentenceUnits(["Hola, mundo. ¿Qué tal?"]);
    expect(
      assembleTranslatedParagraph(
        units,
        [0, 1],
        new Map([[1, "🇷🇺 Как дела?"]]),
      ),
    ).toBe("Hola, mundo.\n\n🇷🇺 Как дела?");
  });
});

describe("paragraphComplete", () => {
  const units = bookSentenceUnits(["12", "Hola."]);

  it("is false when a non-skipped unit lacks a translation", () => {
    expect(paragraphComplete(units, [0, 1], new Map())).toBe(false);
  });

  it("is true when only skipped units lack translations", () => {
    expect(paragraphComplete(units, [0], new Map())).toBe(true);
    expect(paragraphComplete(units, [0, 1], new Map([[1, "Hello."]]))).toBe(
      true,
    );
  });
});
