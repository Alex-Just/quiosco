// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  containerRootPath,
  parsePackage,
  parseTocLabels,
  resolveZipPath,
} from "./opf";

const CONTAINER_XML = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

const EPUBCDIC_XML = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles/>
</container>`;

const OPF2 = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookId" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:title>El manuscrito</dc:title>
    <dc:creator opf:role="aut" opf:file-as="Vidal, Carmen">Carmen Vidal</dc:creator>
    <dc:language>es</dc:language>
    <dc:identifier id="BookId">urn:uuid:123456</dc:identifier>
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="css" href="Styles/base%20style.css" media-type="text/css"/>
    <item id="cap001" href="Text/cap001.xhtml" media-type="application/xhtml+xml"/>
    <item id="cap002" href="Text/cap002.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine toc="ncx">
    <itemref idref="cap001"/>
    <itemref idref="cap002" linear="no"/>
  </spine>
</package>`;

const OPF3 = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookId" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Hola mundo</dc:title>
    <dc:creator>Ada Lovelace</dc:creator>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="cap001" href="Text/cap001.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="cap001"/>
  </spine>
</package>`;

const NAV_XHTML = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <head><title>Índice</title></head>
  <body>
    <nav epub:type="toc" id="toc">
      <h1>Índice</h1>
      <ol>
        <li><a href="Text/cap001.xhtml">Capítulo uno</a></li>
        <li><a href="Text/cap002.xhtml#arriba">Capítulo dos</a></li>
        <li>
          <a href="Text/cap003.xhtml">Capítulo tres</a>
          <ol>
            <li><a href="Text/cap003.xhtml#s1">Más</a></li>
          </ol>
        </li>
      </ol>
    </nav>
  </body>
</html>`;

describe("containerRootPath", () => {
  it("returns the rootfile full-path", () => {
    expect(containerRootPath(CONTAINER_XML)).toBe("OEBPS/content.opf");
  });

  it("returns null without a rootfile", () => {
    expect(containerRootPath(EPUBCDIC_XML)).toBeNull();
  });
});

describe("resolveZipPath", () => {
  it("percent-decodes the href and strips the fragment", () => {
    expect(resolveZipPath("OEBPS", "Text/cap%2001.xhtml#x")).toBe(
      "OEBPS/Text/cap 01.xhtml",
    );
  });

  it("resolves parent segments against the base directory", () => {
    expect(resolveZipPath("OEBPS/Text", "../Images/cover.jpg")).toBe(
      "OEBPS/Images/cover.jpg",
    );
  });

  it("resolves a leading ./ and nested segments", () => {
    expect(resolveZipPath("OEBPS", "./a/b.xhtml")).toBe("OEBPS/a/b.xhtml");
  });

  it("walks a leading ../ up from the document folder", () => {
    expect(resolveZipPath("OEBPS", "../Text/cap002.xhtml")).toBe(
      "Text/cap002.xhtml",
    );
    expect(resolveZipPath("OEBPS/Text", "../../Images/x.jpg")).toBe(
      "Images/x.jpg",
    );
  });

  it("collapses an inner ../ that never leaves the document folder", () => {
    expect(resolveZipPath("OEBPS", "./Styles/../Text/cap.xhtml")).toBe(
      "OEBPS/Text/cap.xhtml",
    );
  });

  it("returns a package-relative path when the base is the package root", () => {
    expect(resolveZipPath("", "Text/cap.xhtml")).toBe("Text/cap.xhtml");
  });
});

describe("parsePackage", () => {
  it("parses metadata, manifest items and the spine of an EPUB2 package", () => {
    const doc = parsePackage(OPF2);
    expect(doc).not.toBeNull();
    if (!doc) return;
    expect(doc.title).toBe("El manuscrito");
    expect(doc.author).toBe("Carmen Vidal");
    expect(doc.language).toBe("es");
    expect(doc.items).toHaveLength(4);
    expect(doc.items[0]).toEqual({
      id: "ncx",
      href: "toc.ncx",
      mediaType: "application/x-dtbncx+xml",
      properties: "",
    });
    expect(doc.items[1]?.href).toBe("Styles/base%20style.css");
    expect(doc.spine).toEqual([
      { idref: "cap001", linear: true },
      { idref: "cap002", linear: false },
    ]);
    expect(doc.ncxId).toBe("ncx");
    expect(doc.navId).toBeNull();
  });

  it("finds the EPUB3 nav item and defaults the spine toc to null", () => {
    const doc = parsePackage(OPF3);
    expect(doc).not.toBeNull();
    if (!doc) return;
    expect(doc.navId).toBe("nav");
    expect(doc.ncxId).toBeNull();
    expect(doc.spine).toEqual([{ idref: "cap001", linear: true }]);
  });

  it("returns null for malformed XML", () => {
    expect(parsePackage("<package><metadata>")).toBeNull();
  });

  it("takes ncxId from the spine toc attribute, not the media type", () => {
    const opf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookId" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Sin tipo NCX</dc:title>
  </metadata>
  <manifest>
    <item id="toc-ref" href="toc.ncx" media-type="application/xml"/>
  </manifest>
  <spine toc="toc-ref">
    <itemref idref="cap001"/>
  </spine>
</package>`;
    const doc = parsePackage(opf);
    expect(doc).not.toBeNull();
    if (!doc) return;
    expect(doc.ncxId).toBe("toc-ref");
  });

  it("prefers the spine toc id over the first NCX-typed manifest item", () => {
    const opf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookId" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Dos índices</dc:title>
  </metadata>
  <manifest>
    <item id="ncx-otro" href="otro.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="ncx-real" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
  </manifest>
  <spine toc="ncx-real">
    <itemref idref="cap001"/>
  </spine>
</package>`;
    const doc = parsePackage(opf);
    expect(doc).not.toBeNull();
    if (!doc) return;
    expect(doc.ncxId).toBe("ncx-real");
  });
});

describe("parseTocLabels", () => {
  it("maps NCX navPoints, including nested ones, to resolved paths", () => {
    const ncx = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE ncx PUBLIC "-//NISO//DTD ncx 2005-1//EN" "http://www.daisy.org/z3986/2005/ncx-2005-1.dtd">
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head><meta name="dtb:uid" content="urn:uuid:123456"/></head>
  <docTitle><text>El manuscrito</text></docTitle>
  <navMap>
    <navPoint id="np-1" playOrder="1">
      <navLabel><text>Portada</text></navLabel>
      <content src="Text/cap%2001.xhtml"/>
      <navPoint id="np-1-1" playOrder="2">
        <navLabel><text>Sección anidada</text></navLabel>
        <content src="Text/cap001.xhtml#parte1"/>
      </navPoint>
    </navPoint>
    <navPoint id="np-2" playOrder="3">
      <navLabel><text>Capítulo dos</text></navLabel>
      <content src="../Text/cap002.xhtml"/>
    </navPoint>
  </navMap>
</ncx>`;
    const labels = parseTocLabels(ncx, "OEBPS");
    expect(labels.get("OEBPS/Text/cap 01.xhtml")).toBe("Portada");
    expect(labels.get("OEBPS/Text/cap001.xhtml")).toBe("Sección anidada");
    expect(labels.get("Text/cap002.xhtml")).toBe("Capítulo dos");
    expect(labels.size).toBe(3);
  });

  it("maps EPUB3 nav anchors to the same kind of label map", () => {
    const labels = parseTocLabels(NAV_XHTML, "OEBPS");
    expect(labels.get("OEBPS/Text/cap001.xhtml")).toBe("Capítulo uno");
    expect(labels.get("OEBPS/Text/cap002.xhtml")).toBe("Capítulo dos");
    expect(labels.get("OEBPS/Text/cap003.xhtml")).toBe("Capítulo tres");
    expect(labels.size).toBe(3);
  });

  it("keeps the first label when several entries point at one path", () => {
    const ncx = `<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <navMap>
    <navPoint id="a" playOrder="1">
      <navLabel><text>Primero</text></navLabel>
      <content src="Text/cap001.xhtml"/>
    </navPoint>
    <navPoint id="b" playOrder="2">
      <navLabel><text>Segundo</text></navLabel>
      <content src="Text/cap001.xhtml"/>
    </navPoint>
  </navMap>
</ncx>`;
    expect(parseTocLabels(ncx, "OEBPS").get("OEBPS/Text/cap001.xhtml")).toBe(
      "Primero",
    );
  });

  it("reads labels from the toc nav, not from earlier navs", () => {
    const nav = `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <body>
    <nav epub:type="landmarks">
      <ol>
        <li><a href="Text/cover.xhtml">Portada</a></li>
        <li><a href="Text/cap001.xhtml">Inicio del texto</a></li>
      </ol>
    </nav>
    <nav epub:type="toc">
      <ol>
        <li><a href="Text/cap001.xhtml">Capítulo uno</a></li>
      </ol>
    </nav>
  </body>
</html>`;
    const labels = parseTocLabels(nav, "OEBPS");
    expect(labels.get("OEBPS/Text/cap001.xhtml")).toBe("Capítulo uno");
    expect(labels.has("OEBPS/Text/cover.xhtml")).toBe(false);
    expect(labels.size).toBe(1);
  });

  it("accepts a plain type token list and falls back when no toc nav exists", () => {
    const typed = `<html xmlns="http://www.w3.org/1999/xhtml">
  <body>
    <nav type="landmarks"><ol><li><a href="cover.xhtml">Portada</a></li></ol></nav>
    <nav type="toc frontmatter"><ol><li><a href="cap001.xhtml">Uno</a></li></ol></nav>
  </body>
</html>`;
    const typedLabels = parseTocLabels(typed, "");
    expect(typedLabels.get("cap001.xhtml")).toBe("Uno");
    expect(typedLabels.has("cover.xhtml")).toBe(false);

    const untyped = `<html xmlns="http://www.w3.org/1999/xhtml">
  <body>
    <nav><ol><li><a href="cap001.xhtml">Uno</a></li></ol></nav>
  </body>
</html>`;
    expect(parseTocLabels(untyped, "").get("cap001.xhtml")).toBe("Uno");
  });
});
