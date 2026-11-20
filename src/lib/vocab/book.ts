import { unzipSync } from "fflate";
import { assembleCard, type LookupResult, paragraphAtOffset } from "./card";

export function cardsFromBook(
  epubBytes: Uint8Array,
  line: string,
): LookupResult {
  let record: unknown;
  try {
    record = JSON.parse(line) as unknown;
  } catch {
    return { ok: false, word: "", reason: "invalid-line" };
  }
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return { ok: false, word: "", reason: "invalid-line" };
  }
  const fields = record as Record<string, unknown>;
  const spine = typeof fields.spine === "number" ? fields.spine : null;
  const chapterHtml = spine === null ? null : chapterHtmlAt(epubBytes, spine);
  if (chapterHtml === null) {
    const word = typeof fields.word === "string" ? fields.word.trim() : "";
    return {
      ok: false,
      word,
      reason: spine === null ? "invalid-line" : "missing-chapter",
    };
  }
  return assembleCard(
    fields,
    paragraphAtOffset(chapterHtml, Number(fields.start_offset)),
  );
}

export interface EpubIdentity {
  title: string;
  author: string;
}

/** Title and author from the book package. The file name is not used. */
export function epubIdentity(epubBytes: Uint8Array): EpubIdentity | null {
  const files = openZip(epubBytes);
  if (!files) return null;
  const container = textFile(files, "META-INF/container.xml");
  const opfPath = container?.match(/full-path=(?:"([^"]+)"|'([^']+)')/);
  const rawPath = (opfPath?.[1] ?? opfPath?.[2] ?? "").replace(/^\//, "");
  if (!rawPath) return null;
  let decoded = rawPath;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    decoded = rawPath;
  }
  const opf = textFile(files, decoded) ?? textFile(files, rawPath);
  if (!opf) return null;
  const title = xmlText(opf, "title");
  if (!title) return null;
  return { title, author: xmlText(opf, "creator") };
}

function openZip(epubBytes: Uint8Array): Record<string, Uint8Array> | null {
  try {
    return unzipSync(epubBytes);
  } catch {
    return null;
  }
}

function chapterHtmlAt(epubBytes: Uint8Array, spine: number): string | null {
  const files = openZip(epubBytes);
  if (!files) return null;
  const container = textFile(files, "META-INF/container.xml");
  const opfPath = container?.match(/full-path="([^"]+)"/)?.[1];
  if (!opfPath) return null;
  const opf = textFile(files, opfPath);
  if (!opf) return null;
  const idrefs = [...opf.matchAll(/<itemref\b[^>]*\bidref="([^"]+)"/g)].map(
    (match) => match[1] ?? "",
  );
  const idref = idrefs[spine];
  if (!idref) return null;
  const item = opf.match(new RegExp(`<item\\b[^>]*\\bid="${idref}"[^>]*>`));
  const href = item?.[0].match(/\bhref="([^"]+)"/)?.[1];
  if (!href) return null;
  const base = opfPath.includes("/")
    ? opfPath.slice(0, opfPath.lastIndexOf("/"))
    : "";
  const path = `${base}/${href}`.replace(/^\//, "");
  return textFile(files, path);
}

function textFile(
  files: Record<string, Uint8Array>,
  path: string,
): string | null {
  const bytes = files[path];
  return bytes ? new TextDecoder().decode(bytes) : null;
}

function xmlText(xml: string, localName: string): string {
  const match = xml.match(
    new RegExp(
      `<(?:[\\w.-]+:)?${localName}\\b[^>]*>([\\s\\S]*?)</(?:[\\w.-]+:)?${localName}>`,
      "i",
    ),
  );
  return decodeXml(match?.[1] ?? "");
}

const MAX_XML_CODE_POINT = 0x10ffff;

function decodeXml(value: string): string {
  const text = value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
      codePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, dec: string) =>
      codePoint(Number.parseInt(dec, 10)),
    )
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&")
    .replace(/\s+/g, " ")
    .trim();
}

function codePoint(value: number): string {
  if (!Number.isInteger(value) || value < 0 || value > MAX_XML_CODE_POINT) {
    return "";
  }
  return String.fromCodePoint(value);
}
