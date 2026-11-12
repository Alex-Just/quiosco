import { type Unzipped, unzipSync } from "fflate";
import { normalizeSentence } from "../sentenceKey";
import { splitFlagStanzas, stripSentenceMarkers } from "../sentences";
import type { BookChapter } from "../types";
import {
  BILINGUAL_SIDECAR_PATH,
  type BilingualBook,
  isBilingualSidecarPath,
  parseBilingualSidecar,
} from "./bilingual";
import { extractChapter } from "./chapterText";
import {
  containerRootPath,
  type PackageItem,
  parsePackage,
  parseTocLabels,
  resolveZipPath,
} from "./opf";

export type EpubErrorCode = "not-epub" | "drm" | "too-large" | "empty";

/** Extra discriminator for codes that map to more than one message. */
export type EpubErrorDetail = "text";

/** Import failure whose code the Add flow maps to a user-facing message. */
export class EpubError extends Error {
  readonly code: EpubErrorCode;
  /** Set when the code alone cannot pick the user-facing message. */
  readonly detail?: EpubErrorDetail;

  constructor(code: EpubErrorCode, detail?: EpubErrorDetail) {
    super(code);
    this.name = "EpubError";
    this.code = code;
    this.detail = detail;
  }
}

export const MAX_BOOK_FILE_BYTES = 25 * 1024 * 1024;
// Bilingual exports contain both the source and the translation, so a large
// novel can exceed the original 2M guard even though its source text fits.
export const MAX_BOOK_CHARS = 4_000_000;

export interface ParsedBook {
  title: string;
  author: string | null;
  language: string | null;
  chapters: BookChapter[];
  /** Present on Quiosco bilingual exports; ignored by other readers. */
  bilingual?: BilingualBook;
}

const decoder = new TextDecoder();

const decode = (bytes: Uint8Array) => decoder.decode(bytes);

const dirname = (path: string) => {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
};

const normalize = (text: string) =>
  text.replace(/\s+/g, " ").trim().toLowerCase();

/**
 * A bilingual export stores one unit per paragraph as
 * "source\n\ntranslation" (flags already stripped). Keep only the source when
 * the block is listed in the sidecar; untranslated blocks stay untouched.
 */
function sourceOnlyParagraphs(
  paragraphs: readonly string[],
  sources: ReadonlySet<string>,
  targets: ReadonlyMap<string, string>,
): string[] {
  return paragraphs.map((paragraph) => {
    if (sources.has(normalizeSentence(paragraph))) return paragraph;
    const parts = paragraph.split("\n\n");
    const first = parts[0]?.trim();
    if (parts.length > 1 && first && sources.has(normalizeSentence(first))) {
      return first;
    }
    const source = targets.get(normalizeSentence(paragraph));
    return source ?? paragraph;
  });
}

/** The translation stanza of a sidecar block, with flags/markers removed. */
function targetStanza(block: string): string {
  const stanzas = splitFlagStanzas(block);
  const stanza =
    stanzas.length >= 2
      ? (stanzas[stanzas.length - 1] ?? "")
      : (block.split(/\n{2,}/).at(-1) ?? block);
  return stripSentenceMarkers(stanza).trim();
}

/**
 * Zip entries the importer reads: container/package XML, NCX, nav and chapter
 * documents. Case-insensitive, so archives that shout their extensions still
 * import; images, stylesheets and fonts are never inflated.
 */
export function isTextEntry(path: string): boolean {
  return /\.(xml|opf|ncx|xhtml|html|htm)$/i.test(path);
}

/**
 * fflate's synchronous unzip. Its async unzip decompresses entries over 512KB
 * in a blob worker; the site's CSP (`worker-src 'self'`) blocks that worker and
 * fflate never reports the failure, leaving the import pending forever. The
 * archive is size-capped, so doing this on the main thread is bounded.
 */
function unzipFiles(bytes: Uint8Array): Unzipped {
  return unzipSync(bytes, {
    filter: (file) =>
      isTextEntry(file.name) || isBilingualSidecarPath(file.name),
  });
}

interface ZipEntry {
  /** Actual zip entry path; may differ in case from the requested path. */
  path: string;
  bytes: Uint8Array;
}

/**
 * Case-tolerant zip lookup: exact path first, then a lowercase map, so
 * archives whose entries disagree with the container/OPF on case still import.
 */
function createLookup(files: Unzipped) {
  const lowercase = new Map<string, string>();
  for (const path of Object.keys(files)) {
    const key = path.toLowerCase();
    if (!lowercase.has(key)) lowercase.set(key, path);
  }
  return (path: string): ZipEntry | null => {
    const actual = Object.hasOwn(files, path)
      ? path
      : lowercase.get(path.toLowerCase());
    if (actual === undefined) return null;
    const bytes = files[actual];
    return bytes === undefined ? null : { path: actual, bytes };
  };
}

/** Elements by local name, tolerating both prefixed and plain spellings. */
function findElements(root: Document | Element, localName: string): Element[] {
  const qualified = Array.from(root.getElementsByTagName(localName));
  if (qualified.length > 0) return qualified;
  return Array.from(root.getElementsByTagNameNS("*", localName));
}

/** Zip-root paths of every `EncryptedData` target in `META-INF/encryption.xml`. */
function encryptedTargets(encryptionXml: string): string[] {
  const doc = new DOMParser().parseFromString(encryptionXml, "application/xml");
  const targets: string[] = [];
  for (const data of findElements(doc, "EncryptedData")) {
    for (const reference of findElements(data, "CipherReference")) {
      const uri = reference.getAttribute("URI")?.trim();
      if (uri) targets.push(resolveZipPath("", uri));
    }
  }
  return targets;
}

/**
 * Turns EPUB bytes into a title, metadata, and plain-text chapters.
 *
 * Rejects with an `EpubError` code: `"too-large"` (file over
 * `MAX_BOOK_FILE_BYTES`, or text over `MAX_BOOK_CHARS` with detail `"text"`),
 * `"not-epub"` (missing/malformed container or package, or any
 * unexpected failure), `"drm"` (encrypted spine content; font obfuscation is
 * fine), or `"empty"` (no readable chapters).
 */
export async function parseEpub(
  bytes: Uint8Array,
  onProgress?: (done: number, total: number) => void,
): Promise<ParsedBook> {
  try {
    if (bytes.length > MAX_BOOK_FILE_BYTES) throw new EpubError("too-large");

    // Paint the form's busy state before decompressing on the main thread.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const files = unzipFiles(bytes);
    const lookup = createLookup(files);
    const sidecarEntry = lookup(BILINGUAL_SIDECAR_PATH);
    const bilingual =
      sidecarEntry === null
        ? undefined
        : (parseBilingualSidecar(decode(sidecarEntry.bytes)) ?? undefined);
    const bilingualSources =
      bilingual === undefined
        ? null
        : new Set(
            bilingual.entries.map((entry) => normalizeSentence(entry.source)),
          );
    const bilingualTargets = new Map<string, string>();
    if (bilingual !== undefined) {
      for (const entry of bilingual.entries) {
        const target = targetStanza(entry.translation);
        if (target)
          bilingualTargets.set(normalizeSentence(target), entry.source);
      }
    }

    const containerEntry = lookup("META-INF/container.xml");
    if (!containerEntry) throw new EpubError("not-epub");
    const packagePath = containerRootPath(decode(containerEntry.bytes));
    const packageEntry = packagePath === null ? null : lookup(packagePath);
    if (!packageEntry) throw new EpubError("not-epub");
    const pkg = parsePackage(decode(packageEntry.bytes));
    if (!pkg) throw new EpubError("not-epub");

    const itemsById = new Map(pkg.items.map((item) => [item.id, item]));
    // Resolve against the entry actually found in the zip, not the declared
    // path, so hrefs keep resolving when the archive differs in case.
    const opfDir = dirname(packageEntry.path);
    const spinePaths = pkg.spine.map((ref) => {
      const item = itemsById.get(ref.idref);
      return item ? resolveZipPath(opfDir, item.href) : null;
    });

    // Content encryption is DRM; font obfuscation is ignored (fonts are not
    // read). Compare canonical zip paths so case differences cannot hide a
    // match.
    const encryptionEntry = lookup("META-INF/encryption.xml");
    if (encryptionEntry) {
      const spineEntries = new Set(
        spinePaths
          .filter((path) => path !== null)
          .map((path) => lookup(path)?.path ?? path),
      );
      for (const target of encryptedTargets(decode(encryptionEntry.bytes))) {
        if (spineEntries.has(lookup(target)?.path ?? target)) {
          throw new EpubError("drm");
        }
      }
    }

    // Chapter titles: NCX labels first, then nav labels on top; their paths
    // are canonicalized to actual zip entries so case differences never split
    // a label from its document.
    const labelByPath = new Map<string, string>();
    const addLabels = (item: PackageItem | undefined) => {
      if (!item) return;
      const entry = lookup(resolveZipPath(opfDir, item.href));
      if (!entry) return;
      for (const [path, label] of parseTocLabels(
        decode(entry.bytes),
        dirname(entry.path),
      )) {
        labelByPath.set(lookup(path)?.path ?? path, label);
      }
    };
    addLabels(pkg.ncxId === null ? undefined : itemsById.get(pkg.ncxId));
    addLabels(pkg.navId === null ? undefined : itemsById.get(pkg.navId));

    const linearDocs = pkg.spine
      .map((ref, index) => ({
        linear: ref.linear,
        path: spinePaths[index] ?? null,
      }))
      .filter((doc) => doc.linear);

    const chapters: BookChapter[] = [];
    let chars = 0;

    for (const [index, doc] of linearDocs.entries()) {
      const entry = doc.path === null ? null : lookup(doc.path);
      if (entry) {
        const { heading, paragraphs } = extractChapter(decode(entry.bytes));
        const sourceParagraphs =
          bilingualSources === null
            ? paragraphs
            : sourceOnlyParagraphs(
                paragraphs,
                bilingualSources,
                bilingualTargets,
              );
        if (sourceParagraphs.length > 0) {
          const title =
            labelByPath.get(entry.path) ??
            heading ??
            `Chapter ${chapters.length + 1}`;
          // The extractor emits a heading as a paragraph too; drop the first
          // paragraph when it would only repeat the chapter title.
          const first = sourceParagraphs[0];
          if (
            first !== undefined &&
            (normalize(first) === normalize(title) ||
              (heading !== null && normalize(first) === normalize(heading)))
          ) {
            sourceParagraphs.shift();
          }
          const text = sourceParagraphs.join("\n\n");
          chars += text.length;
          if (chars > MAX_BOOK_CHARS) throw new EpubError("too-large", "text");
          chapters.push({ title, text });
        }
      }
      onProgress?.(index + 1, linearDocs.length);
      if (index < linearDocs.length - 1) {
        // Yield between documents so a large import keeps the UI responsive.
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }

    const sidecarChapters = bilingual?.chapters ?? [];
    const useSidecarChapters = sidecarChapters.some(
      (chapter) => chapter.text.trim().length > 0,
    );
    const finalChapters = useSidecarChapters ? sidecarChapters : chapters;
    if (finalChapters.length === 0) throw new EpubError("empty");
    const finalChars = finalChapters.reduce(
      (sum, chapter) => sum + chapter.text.length,
      0,
    );
    if (finalChars > MAX_BOOK_CHARS) {
      throw new EpubError("too-large", "text");
    }
    return {
      title: pkg.title,
      author: pkg.author,
      language: pkg.language,
      chapters: finalChapters,
      ...(bilingual === undefined ? {} : { bilingual }),
    };
  } catch (error) {
    if (error instanceof EpubError) throw error;
    throw new EpubError("not-epub");
  }
}
