import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { buildEpubBytes } from "../epub/buildEpub";
import { epubIdentity } from "./book";
import { bodyText } from "./card";
import { cardsFromCatalog, chooseBooks, groupLookups } from "./library";

const EPUB_ID = "11111111-2222-3333-4444-555555555555";
const EPUB_MODIFIED = "2026-11-20T20:00:00.000Z";

function bookBytes(title: string, author: string, sentence: string) {
  return buildEpubBytes({
    title,
    author,
    language: "es",
    uuid: EPUB_ID,
    modified: EPUB_MODIFIED,
    chapters: [{ title: "Uno", paragraphs: [sentence] }],
  });
}

function lookupLine(
  bytes: Uint8Array,
  word: string,
  title: string,
  author: string,
) {
  const files = unzipSync(bytes);
  const chapter = new TextDecoder().decode(
    files["OEBPS/chapter-1.xhtml"] ?? new Uint8Array(),
  );
  const offset = bodyText(
    chapter.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? "",
  ).indexOf(word);
  return JSON.stringify({
    v: 1,
    word,
    headword: word,
    definition: "Adjetivo",
    title,
    author,
    chapter: "Uno",
    page: 1,
    spine: 0,
    start_offset: offset,
  });
}

describe("chooseBooks", () => {
  it("matches the title and author and ignores the file name", () => {
    const chosen = chooseBooks(
      {
        title: "Harry Potter y el Misterio del Príncipe",
        author: "J.K. Rowling",
      },
      [
        {
          path: "/Books/001_alices_adventures_in_wonderland.epub",
          title: "Alice's Adventures in Wonderland",
          author: "Lewis Carroll",
        },
        {
          path: "/Pushed Books/not-used-in-the-match.epub",
          title: "Harry Potter y el Misterio del Príncipe",
          author: "J.K. Rowling",
        },
      ],
    );
    expect(chosen.map((book) => book.path)).toEqual([
      "/Pushed Books/not-used-in-the-match.epub",
    ]);
  });

  it("matches a title when only the letter case differs", () => {
    expect(
      chooseBooks(
        { title: "el principito", author: "antoine de saint-exupéry" },
        [{ title: "El Principito", author: "Antoine de Saint-Exupéry" }],
      ),
    ).toHaveLength(1);
  });

  it("rejects a different author", () => {
    expect(
      chooseBooks({ title: "Drácula", author: "Bram Stoker" }, [
        { title: "Drácula", author: "Otra persona" },
      ]),
    ).toEqual([]);
  });
});

describe("groupLookups", () => {
  it("groups lines from one book and skips a broken line", () => {
    const lines = [
      JSON.stringify({ title: "Uno", author: "Ana", word: "casa" }),
      "{",
      JSON.stringify({ title: "Uno", author: "Ana", word: "mesa" }),
      JSON.stringify({ title: "Dos", author: "Bo", word: "sol" }),
    ];
    const grouped = groupLookups(lines);
    expect(grouped.skipped).toEqual(["{"]);
    expect(grouped.groups.map((group) => group.lines.length)).toEqual([2, 1]);
  });
});

describe("epubIdentity", () => {
  it("reads the title from the package, including an escaped ampersand", () => {
    const bytes = bookBytes("Uno & Dos", "Autora", "Hola.");
    expect(epubIdentity(bytes)).toEqual({
      title: "Uno & Dos",
      author: "Autora",
    });
  });
});

describe("cardsFromCatalog", () => {
  it("uses the book whose title matches, whatever the path is", async () => {
    const potter = bookBytes(
      "Harry Potter y el Misterio del Príncipe",
      "J.K. Rowling",
      "la perseverante copa",
    );
    const other = bookBytes("Otro", "Ana", "Nada.");
    const line = lookupLine(
      potter,
      "perseverante",
      "Harry Potter y el Misterio del Príncipe",
      "J.K. Rowling",
    );
    const opened: string[] = [];
    const results = await cardsFromCatalog(
      [line],
      {
        title: "Harry Potter y el Misterio del Príncipe",
        author: "J.K. Rowling",
      },
      [
        { path: "/Books/001_alices_adventures_in_wonderland.epub" },
        { path: "/Pushed Books/harry-potter-6-bilingual-v5.epub" },
      ],
      async (path) => {
        opened.push(path);
        if (path.startsWith("/Books/")) {
          return { identity: { title: "Otro", author: "Ana" }, bytes: other };
        }
        return {
          identity: {
            title: "Harry Potter y el Misterio del Príncipe",
            author: "J.K. Rowling",
          },
          bytes: potter,
        };
      },
    );
    expect(opened).toEqual([
      "/Books/001_alices_adventures_in_wonderland.epub",
      "/Pushed Books/harry-potter-6-bilingual-v5.epub",
    ]);
    expect(results[0]?.ok).toBe(true);
    if (!results[0]?.ok) return;
    expect(results[0].card.word).toBe("perseverante");
    expect(results[0].card.context).toContain("perseverante");
  });
});
