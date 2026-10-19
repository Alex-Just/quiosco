// @vitest-environment jsdom
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { buildEpubBytes, escapeXml, exportFilename } from "./buildEpub";
import { parseEpub } from "./parseEpub";

const UUID = "11111111-2222-3333-4444-555555555555";
const MODIFIED = "2026-10-19T10:00:00.000Z";

function sampleBytes(): Uint8Array {
  return buildEpubBytes({
    title: "Libro",
    author: "Autora",
    language: "es",
    uuid: UUID,
    modified: MODIFIED,
    chapters: [
      {
        title: "Uno & Dos",
        paragraphs: [
          "María & <yo>",
          "Привет",
          "🇪🇸 Hola",
          "Primera línea\n\nSegunda línea",
        ],
      },
      { title: "Dos", paragraphs: ["Cuerpo dos."] },
    ],
  });
}

describe("buildEpub", () => {
  it("escapes XML special characters", () => {
    expect(escapeXml(`a & <b> "c" 'd'`)).toBe(
      "a &amp; &lt;b&gt; &quot;c&quot; &apos;d&apos;",
    );
  });

  it("sanitizes export filenames", () => {
    expect(exportFilename(`El/Quijote: "1" <parte>`)).toBe(
      "El Quijote 1 parte-bilingual.epub",
    );
    expect(exportFilename("")).toBe("book-bilingual.epub");
    expect(exportFilename("...")).toBe("book-bilingual.epub");
    expect(exportFilename("a".repeat(200))).toBe(
      `${"a".repeat(80)}-bilingual.epub`,
    );
  });

  it("writes a stored mimetype first and all sections in order", () => {
    const bytes = sampleBytes();
    // Compression method of the first local file header: 0 = stored.
    expect(bytes[8]).toBe(0);
    // File name of the first local file header.
    expect(strFromU8(bytes.slice(30, 38))).toBe("mimetype");

    const zip = unzipSync(bytes);
    expect(Object.keys(zip)).toEqual([
      "mimetype",
      "META-INF/container.xml",
      "OEBPS/content.opf",
      "OEBPS/nav.xhtml",
      "OEBPS/toc.ncx",
      "OEBPS/style.css",
      "OEBPS/chapter-1.xhtml",
      "OEBPS/chapter-2.xhtml",
    ]);
    expect(strFromU8(zip.mimetype ?? new Uint8Array())).toBe(
      "application/epub+zip",
    );
    const opf = strFromU8(zip["OEBPS/content.opf"] ?? new Uint8Array());
    expect(opf).toContain(`urn:uuid:${UUID}`);
    expect(opf).toContain(`<dc:title>Libro</dc:title>`);
    expect(opf).toContain(`<dc:creator>Autora</dc:creator>`);
    expect(opf).toContain(`<meta property="dcterms:modified">${MODIFIED}`);
  });

  it("round-trips through the parser with specials and non-Latin text", async () => {
    const parsed = await parseEpub(sampleBytes());

    expect(parsed.title).toBe("Libro");
    expect(parsed.author).toBe("Autora");
    expect(parsed.language).toBe("es");
    expect(parsed.chapters).toHaveLength(2);
    expect(parsed.chapters[0]?.title).toBe("Uno & Dos");
    expect(parsed.chapters[0]?.text).toContain("María & <yo>");
    expect(parsed.chapters[0]?.text).toContain("Привет");
    expect(parsed.chapters[0]?.text).toContain("🇪🇸 Hola");
    expect(parsed.chapters[0]?.text).toContain(
      "Primera línea\n\nSegunda línea",
    );
    expect(parsed.chapters[1]?.title).toBe("Dos");
    expect(parsed.chapters[1]?.text).toBe("Cuerpo dos.");
  });

  it("falls back to Chapter N for empty chapter titles", async () => {
    const parsed = await parseEpub(
      buildEpubBytes({
        title: "Sin capítulos",
        author: null,
        language: null,
        uuid: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        modified: MODIFIED,
        chapters: [{ title: "", paragraphs: ["Solo cuerpo."] }],
      }),
    );

    expect(parsed.chapters[0]?.title).toBe("Chapter 1");
    expect(parsed.chapters[0]?.text).toBe("Solo cuerpo.");
    expect(parsed.language).toBe("en");
    expect(parsed.author).toBeNull();
  });
});
