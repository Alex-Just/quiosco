// @vitest-environment jsdom
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
  EpubError,
  type EpubErrorCode,
  isTextEntry,
  MAX_BOOK_CHARS,
  MAX_BOOK_FILE_BYTES,
  parseEpub,
} from "./parseEpub";

// fflate only encodes DOS timestamps (1980-2099); pin a fixed date inside
// that range so archives are deterministic in every timezone.
const MTIME = Date.UTC(2000, 0, 1);

const epub = (files: Record<string, string | Uint8Array>) =>
  zipSync(
    Object.fromEntries(
      Object.entries(files).map(([path, content]) => [
        path,
        typeof content === "string" ? strToU8(content) : content,
      ]),
    ),
    { mtime: MTIME },
  );

const containerXml = (
  fullPath: string,
) => `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="${fullPath}" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

const chapterXml = (heading: string | null, ...paragraphs: string[]) =>
  `<html xmlns="http://www.w3.org/1999/xhtml">
  <head><title>capítulo</title></head>
  <body>
    ${heading === null ? "" : `<h1>${heading}</h1>`}
    ${paragraphs.map((paragraph) => `<p>${paragraph}</p>`).join("\n")}
  </body>
</html>`;

const navXml = (entries: [href: string, label: string][]) =>
  `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <body>
    <nav epub:type="toc">
      <ol>
        ${entries.map(([href, label]) => `<li><a href="${href}">${label}</a></li>`).join("\n")}
      </ol>
    </nav>
  </body>
</html>`;

const ncxXml = (entries: [src: string, label: string][]) =>
  `<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <navMap>
    ${entries.map(([src, label]) => `<navPoint><navLabel><text>${label}</text></navLabel><content src="${src}"/></navPoint>`).join("\n")}
  </navMap>
</ncx>`;

interface ManifestItemSpec {
  id: string;
  href: string;
  mediaType?: string;
  properties?: string;
}

interface SpineItemSpec {
  idref: string;
  linear?: boolean;
}

interface OpfSpec {
  version?: string;
  title?: string;
  author?: string;
  language?: string;
  items: ManifestItemSpec[];
  spine: SpineItemSpec[];
  tocId?: string;
}

const opfXml = ({
  version = "3.0",
  title,
  author,
  language,
  items,
  spine,
  tocId,
}: OpfSpec) => `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="bookid" version="${version}">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    ${title === undefined ? "" : `<dc:title>${title}</dc:title>`}
    ${author === undefined ? "" : `<dc:creator>${author}</dc:creator>`}
    ${language === undefined ? "" : `<dc:language>${language}</dc:language>`}
  </metadata>
  <manifest>
    ${items.map((item) => `<item id="${item.id}" href="${item.href}" media-type="${item.mediaType ?? "application/xhtml+xml"}"${item.properties === undefined ? "" : ` properties="${item.properties}"`}/>`).join("\n")}
  </manifest>
  <spine${tocId === undefined ? "" : ` toc="${tocId}"`}>
    ${spine.map((item) => `<itemref idref="${item.idref}"${item.linear === false ? ' linear="no"' : ""}/>`).join("\n")}
  </spine>
</package>`;

/** EPUB3 book: nav labels, two linear chapters, one `linear="no"` appendix. */
const epub3 = (overrides: Record<string, string> = {}) => ({
  mimetype: "application/epub+zip",
  "META-INF/container.xml": containerXml("OEBPS/content.opf"),
  "OEBPS/content.opf": opfXml({
    title: "El principito",
    author: "Antoine de Saint-Exupéry",
    language: "es",
    items: [
      { id: "nav", href: "nav.xhtml", properties: "nav" },
      { id: "c1", href: "Text/cap001.xhtml" },
      { id: "c2", href: "Text/cap002.xhtml" },
      { id: "apendice", href: "Text/apendice.xhtml" },
    ],
    spine: [
      { idref: "c1" },
      { idref: "c2" },
      { idref: "apendice", linear: false },
    ],
  }),
  "OEBPS/nav.xhtml": navXml([
    ["Text/cap001.xhtml", "Capítulo uno"],
    ["Text/cap002.xhtml", "Capítulo dos"],
  ]),
  "OEBPS/Text/cap001.xhtml": chapterXml("Capítulo uno", "Había una vez."),
  "OEBPS/Text/cap002.xhtml": chapterXml("Capítulo dos", "Y colorín colorado."),
  "OEBPS/Text/apendice.xhtml": chapterXml("Apéndice", "Material extra."),
  ...overrides,
});

const encryptionXml = (uri: string) => `<?xml version="1.0" encoding="UTF-8"?>
<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:enc="http://www.w3.org/2001/04/xmlenc#">
  <enc:EncryptedData>
    <enc:EncryptionMethod Algorithm="http://www.idpf.org/2008/embedding"/>
    <enc:CipherData>
      <enc:CipherReference URI="${uri}"/>
    </enc:CipherData>
  </enc:EncryptedData>
</encryption>`;

async function expectCode(promise: Promise<unknown>, code: EpubErrorCode) {
  const error = await promise.then(
    () => null,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(EpubError);
  expect((error as EpubError).code).toBe(code);
}

describe("isTextEntry", () => {
  it("accepts book text and metadata entries", () => {
    for (const path of [
      "META-INF/container.xml",
      "OEBPS/content.opf",
      "OEBPS/toc.ncx",
      "OEBPS/nav.xhtml",
      "OEBPS/Text/cap 01.XHTML",
      "OEBPS/Text/legacy.htm",
    ]) {
      expect(isTextEntry(path)).toBe(true);
    }
  });

  it("rejects images, stylesheets, fonts, and extensionless entries", () => {
    for (const path of [
      "OEBPS/Images/cover.jpg",
      "OEBPS/Images/cover.PNG",
      "OEBPS/Styles/base.css",
      "OEBPS/Fonts/lib.otf",
      "mimetype",
    ]) {
      expect(isTextEntry(path)).toBe(false);
    }
  });
});

describe("parseEpub", () => {
  it("imports an EPUB3 book with metadata and nav chapter titles", async () => {
    const book = await parseEpub(epub(epub3()));
    expect(book.title).toBe("El principito");
    expect(book.author).toBe("Antoine de Saint-Exupéry");
    expect(book.language).toBe("es");
    expect(book.chapters).toEqual([
      { title: "Capítulo uno", text: "Había una vez." },
      { title: "Capítulo dos", text: "Y colorín colorado." },
    ]);
  });

  it("excludes linear='no' spine items", async () => {
    const book = await parseEpub(epub(epub3()));
    expect(book.chapters).toHaveLength(2);
    expect(book.chapters.map((chapter) => chapter.title)).toEqual([
      "Capítulo uno",
      "Capítulo dos",
    ]);
  });

  it("falls back to NCX labels when there is no nav", async () => {
    const files = {
      mimetype: "application/epub+zip",
      "META-INF/container.xml": containerXml("OEBPS/content.opf"),
      "OEBPS/content.opf": opfXml({
        version: "2.0",
        title: "El manuscrito",
        author: "Carmen Vidal",
        language: "es",
        tocId: "ncx",
        items: [
          { id: "ncx", href: "toc.ncx", mediaType: "application/x-dtbncx+xml" },
          { id: "c1", href: "Text/cap001.xhtml" },
          { id: "c2", href: "Text/cap002.xhtml" },
        ],
        spine: [{ idref: "c1" }, { idref: "c2" }],
      }),
      "OEBPS/toc.ncx": ncxXml([
        ["Text/cap001.xhtml", "Portada"],
        ["Text/cap002.xhtml#inicio", "Capítulo dos"],
      ]),
      "OEBPS/Text/cap001.xhtml": chapterXml(null, "Primera página."),
      "OEBPS/Text/cap002.xhtml": chapterXml(null, "Segunda página."),
    };
    const book = await parseEpub(epub(files));
    expect(book.chapters).toEqual([
      { title: "Portada", text: "Primera página." },
      { title: "Capítulo dos", text: "Segunda página." },
    ]);
  });

  it("prefers nav labels over NCX labels", async () => {
    const files = epub3({
      "OEBPS/content.opf": opfXml({
        title: "Dos índices",
        items: [
          { id: "nav", href: "nav.xhtml", properties: "nav" },
          { id: "ncx", href: "toc.ncx", mediaType: "application/x-dtbncx+xml" },
          { id: "c1", href: "Text/cap001.xhtml" },
        ],
        spine: [{ idref: "c1" }],
      }),
      "OEBPS/toc.ncx": ncxXml([["Text/cap001.xhtml", "Desde el NCX"]]),
    });
    // The nav still labels cap001 "Capítulo uno".
    const book = await parseEpub(epub(files));
    expect(book.chapters[0]?.title).toBe("Capítulo uno");
  });

  it("falls back to the document heading, then numbered chapters", async () => {
    const files = {
      mimetype: "application/epub+zip",
      "META-INF/container.xml": containerXml("OEBPS/content.opf"),
      "OEBPS/content.opf": opfXml({
        title: "Fallbacks",
        items: [
          { id: "c1", href: "Text/cap001.xhtml" },
          { id: "c2", href: "Text/cap002.xhtml" },
          { id: "c3", href: "Text/cap003.xhtml" },
        ],
        spine: [{ idref: "c1" }, { idref: "c2" }, { idref: "c3" }],
      }),
      "OEBPS/Text/cap001.xhtml": chapterXml(null, "Uno."),
      "OEBPS/Text/cap002.xhtml": chapterXml("Prólogo", "Dos."),
      "OEBPS/Text/cap003.xhtml": chapterXml(null, "Tres."),
    };
    const book = await parseEpub(epub(files));
    expect(book.chapters.map((chapter) => chapter.title)).toEqual([
      "Chapter 1",
      "Prólogo",
      "Chapter 3",
    ]);
    expect(book.chapters.map((chapter) => chapter.text)).toEqual([
      "Uno.",
      "Dos.",
      "Tres.",
    ]);
  });

  it("drops a first paragraph that repeats the resolved title ignoring case", async () => {
    const files = epub3({
      "OEBPS/Text/cap001.xhtml": chapterXml(null, "capítulo uno", "Texto."),
    });
    const book = await parseEpub(epub(files));
    expect(book.chapters[0]).toEqual({
      title: "Capítulo uno",
      text: "Texto.",
    });
  });

  it("drops a heading paragraph that differs from the resolved title", async () => {
    const files = epub3({
      "OEBPS/nav.xhtml": navXml([
        ["Text/cap001.xhtml", "Primer capítulo"],
        ["Text/cap002.xhtml", "Capítulo dos"],
      ]),
      "OEBPS/Text/cap001.xhtml": chapterXml("Uno", "Cuerpo."),
    });
    const book = await parseEpub(epub(files));
    expect(book.chapters[0]).toEqual({
      title: "Primer capítulo",
      text: "Cuerpo.",
    });
  });

  it("keeps a distinct first paragraph and joins paragraphs with blank lines", async () => {
    const files = epub3({
      "OEBPS/Text/cap001.xhtml": chapterXml(
        null,
        "Primera línea.",
        "Segunda línea.",
      ),
    });
    const book = await parseEpub(epub(files));
    expect(book.chapters[0]).toEqual({
      title: "Capítulo uno",
      text: "Primera línea.\n\nSegunda línea.",
    });
  });

  it("resolves ../ and percent-encoded hrefs", async () => {
    const files = {
      mimetype: "application/epub+zip",
      "META-INF/container.xml": containerXml("OEBPS/OPF/content.opf"),
      "OEBPS/OPF/content.opf": opfXml({
        version: "2.0",
        title: "Rutas",
        tocId: "ncx",
        items: [
          { id: "ncx", href: "toc.ncx", mediaType: "application/x-dtbncx+xml" },
          { id: "c1", href: "../Text/cap%2001.xhtml" },
        ],
        spine: [{ idref: "c1" }],
      }),
      "OEBPS/OPF/toc.ncx": ncxXml([
        ["../Text/cap%2001.xhtml", "Capítulo con espacio"],
      ]),
      "OEBPS/Text/cap 01.xhtml": chapterXml("Título distinto", "Texto."),
    };
    const book = await parseEpub(epub(files));
    expect(book.chapters).toEqual([
      { title: "Capítulo con espacio", text: "Texto." },
    ]);
  });

  it("imports a font-obfuscated book", async () => {
    const files = epub3({
      "OEBPS/content.opf": opfXml({
        title: "Con fuente ofuscada",
        items: [
          { id: "nav", href: "nav.xhtml", properties: "nav" },
          { id: "c1", href: "Text/cap001.xhtml" },
          { id: "c2", href: "Text/cap002.xhtml" },
          {
            id: "font",
            href: "Fonts/x.ttf",
            mediaType: "application/font-sfnt",
          },
        ],
        spine: [{ idref: "c1" }, { idref: "c2" }],
      }),
      "OEBPS/Fonts/x.ttf": "not really a font",
      "META-INF/encryption.xml": encryptionXml("OEBPS/Fonts/x.ttf"),
    });
    const book = await parseEpub(epub(files));
    expect(book.chapters).toHaveLength(2);
  });

  it("rejects a book whose spine content is encrypted", async () => {
    const files = epub3({
      "OEBPS/content.opf": opfXml({
        title: "Con DRM",
        items: [
          { id: "nav", href: "nav.xhtml", properties: "nav" },
          { id: "c1", href: "Text/cap%2001.xhtml" },
          { id: "c2", href: "Text/cap002.xhtml" },
        ],
        spine: [{ idref: "c1" }, { idref: "c2" }],
      }),
      "OEBPS/nav.xhtml": navXml([
        ["Text/cap%2001.xhtml", "Capítulo uno"],
        ["Text/cap002.xhtml", "Capítulo dos"],
      ]),
      "OEBPS/Text/cap 01.xhtml": chapterXml("Capítulo uno", "Había una vez."),
      "META-INF/encryption.xml": encryptionXml("OEBPS/Text/cap%2001.xhtml"),
    });
    await expectCode(parseEpub(epub(files)), "drm");
  });

  it("rejects a zip without META-INF/container.xml", async () => {
    await expectCode(
      parseEpub(epub({ "OEBPS/content.opf": "<package/>" })),
      "not-epub",
    );
  });

  it("rejects bytes that are not a zip", async () => {
    await expectCode(parseEpub(new Uint8Array([1, 2, 3, 4])), "not-epub");
  });

  it("reports a book with no readable text as empty", async () => {
    const files = epub3({
      "OEBPS/Text/cap001.xhtml": "<html><body>   </body></html>",
      "OEBPS/Text/cap002.xhtml": "<html><body><div></div></body></html>",
    });
    await expectCode(parseEpub(epub(files)), "empty");
  });

  it("rejects a book whose text exceeds the character cap", async () => {
    const files = epub3({
      "OEBPS/Text/cap001.xhtml": chapterXml(
        null,
        "a ".repeat(MAX_BOOK_CHARS / 2 + 1),
      ),
    });
    const error = await parseEpub(epub(files)).then(
      () => null,
      (reason: unknown) => reason,
    );
    expect(error).toBeInstanceOf(EpubError);
    expect((error as EpubError).code).toBe("too-large");
    expect((error as EpubError).detail).toBe("text");
  });

  it("rejects files over the byte cap", async () => {
    const error = await parseEpub(new Uint8Array(MAX_BOOK_FILE_BYTES + 1)).then(
      () => null,
      (reason: unknown) => reason,
    );
    expect(error).toBeInstanceOf(EpubError);
    expect((error as EpubError).code).toBe("too-large");
    expect((error as EpubError).detail).toBeUndefined();
  });

  it("reports progress once per linear spine document", async () => {
    const calls: [done: number, total: number][] = [];
    const book = await parseEpub(epub(epub3()), (done, total) => {
      calls.push([done, total]);
    });
    expect(book.chapters).toHaveLength(2);
    expect(calls).toEqual([
      [1, 2],
      [2, 2],
    ]);
  });

  it("imports a book whose zip also holds images and stylesheets", async () => {
    const files = epub3({
      "OEBPS/Styles/base.css": "body { color: black; }",
    });
    const book = await parseEpub(
      epub({
        ...files,
        "OEBPS/Images/cover.jpg": new Uint8Array([0xff, 0xd8, 0xff, 0xe0]),
      }),
    );
    expect(book.chapters).toHaveLength(2);
  });

  it("imports despite a case-mismatched OPF path", async () => {
    const files = {
      mimetype: "application/epub+zip",
      "META-INF/container.xml": containerXml("OEBPS/content.opf"),
      "oebps/content.opf": opfXml({
        title: "Minúsculas",
        items: [{ id: "c1", href: "Text/cap001.xhtml" }],
        spine: [{ idref: "c1" }],
      }),
      "oebps/Text/cap001.xhtml": chapterXml("Uno", "Texto."),
    };
    const book = await parseEpub(epub(files));
    expect(book.chapters).toEqual([{ title: "Uno", text: "Texto." }]);
  });
});
