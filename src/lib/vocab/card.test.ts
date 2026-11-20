import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { buildEpubBytes } from "../epub/buildEpub";
import { cardsFromBook } from "./book";
import {
  ankiFields,
  bodyText,
  cardId,
  paragraphAtOffset,
  parseVocabulary,
} from "./card";

const CHAPTER_HTML = `<html><head><title>3 Reencuentros</title></head><body>
<h1>3 Reencuentros y noticias</h1>
<p class="s"><br/>Antes.</p>
<p class="s break"><br/>la perseverante copa<br/><br/>настойчивый бокал</p>
</body></html>`;

describe("paragraphAtOffset", () => {
  it("returns the sentence pair that contains the codepoint offset", () => {
    const body = CHAPTER_HTML.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? "";
    const offset = bodyText(body).indexOf("perseverante");
    expect(offset).toBeGreaterThan(0);
    expect(paragraphAtOffset(CHAPTER_HTML, offset)).toBe(
      "la perseverante copa\n\nнастойчивый бокал",
    );
  });

  it("returns null when the offset is outside every paragraph", () => {
    expect(paragraphAtOffset(CHAPTER_HTML, 0)).toBeNull();
  });
});

describe("cardsFromBook", () => {
  it("builds one stable card from a vocabulary line and the exported book", () => {
    const bytes = buildEpubBytes({
      title: "Harry Potter y el Misterio del Príncipe",
      author: "J.K. Rowling",
      language: "es",
      uuid: "11111111-2222-3333-4444-555555555555",
      modified: "2026-11-20T20:00:00.000Z",
      chapters: [
        {
          title: "Uno",
          paragraphs: ["Antes."],
        },
        {
          title: "3 Reencuentros y noticias",
          paragraphs: ["la perseverante copa\n\nнастойчивый бокал"],
        },
      ],
    });
    const files = unzipSync(bytes);
    const chapter = new TextDecoder().decode(
      files["OEBPS/chapter-2.xhtml"] ?? new Uint8Array(),
    );
    const offset = bodyText(
      chapter.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? "",
    ).indexOf("perseverante");
    const line = JSON.stringify({
      v: 1,
      word: "perseverante",
      headword: "perseverante",
      definition:
        " Adjetivo\npronunciación (AFI): [peɾseβ̞eˈɾãn̪t̪e]\n1Que se mantiene constante.",
      title: "Harry Potter y el Misterio del Príncipe",
      author: "J.K. Rowling",
      chapter: "3 Reencuentros y noticias",
      page: 165,
      spine: 1,
      start_offset: offset,
    });

    const [first, second] = [
      cardsFromBook(bytes, line),
      cardsFromBook(bytes, line),
    ];
    expect(first).toEqual(second);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.card.id).toBe(cardId(first.card));
    expect(first.card.context).toContain("perseverante");
    expect(first.card.context).toContain("настойчивый");
    expect(ankiFields(first.card)).toEqual({
      Word: "perseverante",
      "Part of Speech": "Adjetivo",
      Transcription: "peɾseβ̞eˈɾãn̪t̪e",
      Translation: "настойчивый бокал",
      Context: "la perseverante copa",
      Additional:
        "Harry Potter y el Misterio del Príncipe — 3 Reencuentros y noticias, p. 165. Que se mantiene constante.",
    });
  });

  it("skips a line that is not a vocabulary record", () => {
    const bytes = buildEpubBytes({
      title: "Libro",
      author: "Autora",
      language: "es",
      uuid: "11111111-2222-3333-4444-555555555555",
      modified: "2026-11-20T20:00:00.000Z",
      chapters: [{ title: "Uno", paragraphs: ["Hola."] }],
    });
    expect(cardsFromBook(bytes, "{")).toEqual({
      ok: false,
      word: "",
      reason: "invalid-line",
    });
  });
});

describe("parseVocabulary", () => {
  it("keeps one record per non-empty line", () => {
    const text = `${JSON.stringify({ word: "casa", spine: 0, start_offset: 1 })}\n\n`;
    expect(parseVocabulary(text)).toHaveLength(1);
  });
});
