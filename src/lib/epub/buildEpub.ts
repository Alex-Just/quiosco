// EPUB writing for book export: chapter text and metadata in, a complete
// EPUB 3 (with an EPUB 2 NCX for older readers such as the PocketBook's stock
// reader) out. The structure stays minimal and strictly well-formed; fflate
// stores the mimetype entry first and deflates the rest.
import { strToU8, type Zippable, zipSync } from "fflate";

export interface EpubChapterInput {
  title: string;
  /** Display blocks per sentence unit; "\n" separates lines/stanzas. */
  paragraphs: string[];
}

export function escapeXml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

/**
 * Download name for an exported book: characters Android forbids in file
 * names become spaces, the result is trimmed and capped, and an empty or
 * fully-stripped title falls back to "book".
 */
export function exportFilename(title: string): string {
  const cleaned = title
    // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control characters out of file names is the intent
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/, "")
    .slice(0, 80)
    .trim()
    .replace(/[. ]+$/, "");
  return `${cleaned || "book"}-bilingual.epub`;
}

const MIMETYPE = "application/epub+zip";

const CONTAINER_XML = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`;

const STYLE_CSS = `body { line-height: 1.4; }
p { margin: 0; }
p.s + p.s { page-break-before: always; break-before: page; }
`;

/** One `<p class="s">` per display block; lines join with `<br/>`. */
function paragraphXml(block: string): string {
  const lines = block.split("\n");
  while (lines.length > 0 && lines[0]?.trim() === "") lines.shift();
  while (lines.length > 0 && lines[lines.length - 1]?.trim() === "") {
    lines.pop();
  }
  if (lines.length === 0) return "";
  // The leading break opens every page with one blank line.
  return `    <p class="s"><br/>${lines.map(escapeXml).join("<br/>")}</p>`;
}

function chapterXml(label: string, chapter: EpubChapterInput): string {
  const body = chapter.paragraphs
    .map(paragraphXml)
    .filter((paragraph) => paragraph !== "")
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head><title>${escapeXml(label)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
  <body>
${body}
  </body>
</html>
`;
}

function packageXml(
  input: {
    title: string;
    author: string | null;
    language: string | null;
    uuid: string;
    modified: string;
  },
  labels: readonly string[],
): string {
  const metadata = [
    `    <dc:identifier id="bookid">urn:uuid:${escapeXml(input.uuid)}</dc:identifier>`,
    `    <dc:title>${escapeXml(input.title)}</dc:title>`,
    input.author === null
      ? null
      : `    <dc:creator>${escapeXml(input.author)}</dc:creator>`,
    `    <dc:language>${escapeXml(input.language ?? "en")}</dc:language>`,
    `    <meta property="dcterms:modified">${escapeXml(input.modified)}</meta>`,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
  const manifest = [
    `    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`,
    `    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>`,
    `    <item id="css" href="style.css" media-type="text/css"/>`,
    ...labels.map(
      (_, index) =>
        `    <item id="chapter-${index + 1}" href="chapter-${index + 1}.xhtml" media-type="application/xhtml+xml"/>`,
    ),
  ].join("\n");
  const spine = labels
    .map((_, index) => `    <itemref idref="chapter-${index + 1}"/>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
${metadata}
  </metadata>
  <manifest>
${manifest}
  </manifest>
  <spine toc="ncx">
${spine}
  </spine>
</package>
`;
}

function navXml(title: string, labels: readonly string[]): string {
  const items = labels
    .map(
      (label, index) =>
        `        <li><a href="chapter-${index + 1}.xhtml">${escapeXml(label)}</a></li>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <head><title>${escapeXml(title)}</title></head>
  <body>
    <nav epub:type="toc">
      <ol>
${items}
      </ol>
    </nav>
  </body>
</html>
`;
}

function ncxXml(
  title: string,
  uuid: string,
  labels: readonly string[],
): string {
  const points = labels
    .map(
      (
        label,
        index,
      ) => `    <navPoint id="nav-${index + 1}" playOrder="${index + 1}">
      <navLabel><text>${escapeXml(label)}</text></navLabel>
      <content src="chapter-${index + 1}.xhtml"/>
    </navPoint>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="urn:uuid:${escapeXml(uuid)}"/>
  </head>
  <docTitle><text>${escapeXml(title)}</text></docTitle>
  <navMap>
${points}
  </navMap>
</ncx>
`;
}

/**
 * Assemble one complete EPUB: container, package (EPUB 3), nav, NCX, style,
 * and one chapter document per input chapter, in spine order. Chapter labels
 * fall back to "Chapter N" for untitled chapters.
 */
export function buildEpubBytes(input: {
  title: string;
  author: string | null;
  language: string | null;
  chapters: readonly EpubChapterInput[];
  uuid: string;
  modified: string;
}): Uint8Array {
  const labels = input.chapters.map((chapter, index) =>
    chapter.title.trim() ? chapter.title.trim() : `Chapter ${index + 1}`,
  );
  const files: Zippable = {
    mimetype: [strToU8(MIMETYPE), { level: 0 }],
    "META-INF/container.xml": strToU8(CONTAINER_XML),
    "OEBPS/content.opf": strToU8(packageXml(input, labels)),
    "OEBPS/nav.xhtml": strToU8(navXml(input.title, labels)),
    "OEBPS/toc.ncx": strToU8(ncxXml(input.title, input.uuid, labels)),
    "OEBPS/style.css": strToU8(STYLE_CSS),
  };
  input.chapters.forEach((chapter, index) => {
    files[`OEBPS/chapter-${index + 1}.xhtml`] = strToU8(
      chapterXml(labels[index] ?? `Chapter ${index + 1}`, chapter),
    );
  });
  return zipSync(files);
}
