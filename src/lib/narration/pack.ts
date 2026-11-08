// Turn a pack zip into the stored form: the manifest plus, for every chapter,
// the byte range of its audio inside the same archive.

import {
  MANIFEST_ENTRY,
  NarrationError,
  type NarrationPack,
  parseManifest,
} from "./manifest";
import { readZipEntry, readZipIndex } from "./zip";

const decoder = new TextDecoder();

/** Validate a picked pack and resolve each chapter to its bytes. */
export async function readNarrationPack(archive: Blob): Promise<NarrationPack> {
  const entries = await readZipIndex(archive);
  const manifestEntry = entries.get(MANIFEST_ENTRY);
  if (!manifestEntry) throw new NarrationError(`pack has no ${MANIFEST_ENTRY}`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(
      decoder.decode(await readZipEntry(archive, manifestEntry)),
    );
  } catch (error) {
    if (error instanceof NarrationError) throw error;
    throw new NarrationError(`${MANIFEST_ENTRY} is not valid JSON`);
  }
  const manifest = parseManifest(parsed);

  const chapters = manifest.chapters.map((chapter) => {
    if (chapter.audio.length === 0) {
      // Not covered by the recording: keep the slot so chapter indices still
      // line up with the reader's, but carry no bytes.
      return {
        offset: 0,
        size: 0,
        duration: 0,
        starts: chapter.starts,
        ends: chapter.ends,
      };
    }
    const entry = entries.get(chapter.audio);
    if (!entry) {
      throw new NarrationError(`pack is missing ${chapter.audio}`);
    }
    return {
      offset: entry.offset,
      size: entry.size,
      duration: chapter.duration,
      starts: chapter.starts,
      ends: chapter.ends,
    };
  });

  return {
    version: manifest.version,
    title: manifest.title,
    createdAt: Date.now(),
    chapters,
    archive,
  };
}
