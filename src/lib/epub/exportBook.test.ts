import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { bookFlatParagraphs, bookSentenceUnits } from "../bookText";
import { rulesHash, sentenceCacheKey } from "../sentenceKey";
import type { Article, BookChapter, SentenceCacheEntry } from "../types";
import { assembleExportChapters, exportBookEpub } from "./exportBook";

const MATERIAL = { targetLanguage: "English", rules: "r" };

function bookArticle(chapters?: BookChapter[], text = ""): Article {
  return {
    id: "book-1",
    url: null,
    title: "Libro",
    site: null,
    text,
    via: "manual",
    kind: "book",
    author: "Autora",
    bookLanguage: "es",
    chapters,
    translation: null,
    translationStatus: "pending",
    translatedChunks: 0,
    totalChunks: 0,
    status: "unread",
    error: null,
    createdAt: 1,
    updatedAt: 1,
  };
}

function unitsOf(article: Article) {
  return bookSentenceUnits(bookFlatParagraphs(article));
}

function fakeStore(entries: readonly SentenceCacheEntry[]) {
  const byKey = new Map(entries.map((entry) => [entry.key, entry]));
  const calls: string[][] = [];
  return {
    calls,
    store: {
      async getSentences(keys: readonly string[]) {
        calls.push([...keys]);
        const found = keys
          .map((key) => byKey.get(key))
          .filter((entry): entry is SentenceCacheEntry => entry !== undefined);
        return found;
      },
    },
  };
}

async function entryFor(
  source: string,
  translation: string,
): Promise<SentenceCacheEntry> {
  return {
    key: await sentenceCacheKey(source, MATERIAL),
    source,
    translation,
    targetLanguage: MATERIAL.targetLanguage,
    rulesHash: await rulesHash(MATERIAL.rules),
    model: "m",
    createdAt: 1,
  };
}

function chapterXhtml(bytes: Uint8Array, index = 1): string {
  const zip = unzipSync(bytes);
  return strFromU8(zip[`OEBPS/chapter-${index}.xhtml`] ?? new Uint8Array());
}

describe("assembleExportChapters", () => {
  it("uses the cached display block and falls back to source", () => {
    const article = bookArticle([{ title: "Uno", text: "Hola. Adiós." }]);
    const chapters = assembleExportChapters({
      article,
      units: unitsOf(article),
      translations: new Map([[1, "🇪🇸 Hola.\n🇬🇧 Hello."]]),
    });

    expect(chapters).toEqual([
      { title: "Uno", paragraphs: ["Hola.\n\nHello.", "Adiós."] },
    ]);
  });

  it("drops language flags that e-readers render as tofu boxes", () => {
    const article = bookArticle([{ title: "Uno", text: "Hola." }]);
    const chapters = assembleExportChapters({
      article,
      units: unitsOf(article),
      translations: new Map([[1, "🇪🇸 Hola.\n🇷🇺 Привет."]]),
    });

    const block = chapters[0]?.paragraphs[0] ?? "";
    expect(block).toBe("Hola.\n\nПривет.");
    expect(block).not.toMatch(/[\u{1F1E6}-\u{1F1FF}]/u);
  });

  it("restores the source stanza of a translation-only cached block", () => {
    const article = bookArticle([{ title: "Uno", text: "Hola. Adiós." }]);
    const chapters = assembleExportChapters({
      article,
      units: unitsOf(article),
      translations: new Map([[1, "🇬🇧 Hello."]]),
    });

    expect(chapters[0]?.paragraphs[0]).toBe("Hola.\n\nHello.");
  });

  it("never re-renders title units and renders skipped units from source", () => {
    const article = bookArticle([
      { title: "Uno", text: "***\n\nHola. Adiós." },
    ]);
    const units = unitsOf(article);
    expect(units.map((unit) => [unit.text, unit.skipped])).toEqual([
      ["Uno", false],
      ["***", true],
      ["Hola.", false],
      ["Adiós.", false],
    ]);

    const chapters = assembleExportChapters({
      article,
      units,
      translations: new Map([[2, "🇪🇸 Hola.\n🇬🇧 Hello."]]),
    });

    expect(chapters).toEqual([
      {
        title: "Uno",
        paragraphs: ["***", "Hola.\n\nHello.", "Adiós."],
      },
    ]);
  });

  it("exports one untitled chapter when the book has no chapters", () => {
    const article = bookArticle(undefined, "Hola.\n\nAdiós.");
    const chapters = assembleExportChapters({
      article,
      units: unitsOf(article),
      translations: new Map(),
    });

    expect(chapters).toEqual([{ title: "", paragraphs: ["Hola.", "Adiós."] }]);
  });
});

describe("exportBookEpub", () => {
  it("builds a downloadable EPUB with cached entries and source fallback", async () => {
    const article = bookArticle([{ title: "Uno", text: "Hola. Adiós." }]);
    const { store, calls } = fakeStore([
      await entryFor("Hola.", "🇬🇧 T: Hola."),
    ]);

    const result = await exportBookEpub({
      store,
      article,
      settings: MATERIAL,
      uuid: "test-uuid",
      now: new Date("2026-10-19T12:00:00Z"),
      readBatchUnits: 2,
    });

    expect(result.filename).toBe("Libro-bilingual.epub");
    const zip = unzipSync(result.bytes);
    expect(strFromU8(zip.mimetype ?? new Uint8Array())).toBe(
      "application/epub+zip",
    );
    const opf = strFromU8(zip["OEBPS/content.opf"] ?? new Uint8Array());
    expect(opf).toContain("urn:uuid:test-uuid");
    expect(opf).toContain("2026-10-19T12:00:00.000Z");
    expect(opf).toContain("<dc:language>es</dc:language>");
    const chapter = chapterXhtml(result.bytes);
    expect(chapter).toContain("T: Hola."); // cached
    expect(chapter).toContain("Adiós."); // source fallback
    expect(chapter).not.toContain("T: Adiós.");
    // reads arrived in batches of two units, then the remainder
    expect(calls.map((keys) => keys.length)).toEqual([2, 1]);
  });

  it("does not count an entry cached under another rules hash", async () => {
    const article = bookArticle([{ title: "Uno", text: "Hola. Adiós." }]);
    const entry = await entryFor("Hola.", "🇬🇧 T: Hola.");
    const { store } = fakeStore([
      { ...entry, rulesHash: await rulesHash("other") },
    ]);

    const result = await exportBookEpub({
      store,
      article,
      settings: MATERIAL,
      uuid: "test-uuid",
      now: new Date("2026-10-19T12:00:00Z"),
    });

    const chapter = chapterXhtml(result.bytes);
    expect(chapter).toContain("Hola.");
    expect(chapter).not.toContain("T:");
  });

  it("shares one cache entry across duplicate sentences", async () => {
    const article = bookArticle(undefined, "Hola.\n\nHola.");
    const { store } = fakeStore([
      await entryFor("Hola.", "🇪🇸 Hola.\n🇬🇧 T: Hola."),
    ]);

    const result = await exportBookEpub({
      store,
      article,
      settings: MATERIAL,
      uuid: "test-uuid",
      now: new Date("2026-10-19T12:00:00Z"),
    });

    const chapter = chapterXhtml(result.bytes);
    expect((chapter.match(/T: Hola\./g) ?? []).length).toBe(2);
  });

  it("shares one cache entry across whitespace variants", async () => {
    const article = bookArticle(undefined, "Hello  world.\n\nHello world.");
    const { store } = fakeStore([
      await entryFor("Hello world.", "🇬🇧 T: Hello world."),
    ]);

    const result = await exportBookEpub({
      store,
      article,
      settings: MATERIAL,
      uuid: "test-uuid",
      now: new Date("2026-10-19T12:00:00Z"),
    });

    const chapter = chapterXhtml(result.bytes);
    expect((chapter.match(/T: Hello world\./g) ?? []).length).toBe(2);
  });

  it("builds the file from source text when nothing is cached", async () => {
    const article = bookArticle([{ title: "Uno", text: "Hola. Adiós." }]);
    const { store } = fakeStore([]);

    const result = await exportBookEpub({
      store,
      article,
      settings: MATERIAL,
      uuid: "test-uuid",
      now: new Date("2026-10-19T12:00:00Z"),
    });

    const chapter = chapterXhtml(result.bytes);
    expect(chapter).not.toContain("<h1>"); // chapter labels live in the TOC
    expect(chapter).toContain("Hola.");
    expect(chapter).toContain("Adiós.");
    expect(chapter).not.toContain('<p class="s">Uno</p>'); // no title in body
    expect(chapter).not.toContain("T:");
  });
});
