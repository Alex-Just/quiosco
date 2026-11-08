// The narration pack format: a zip holding `narration.json` plus one audio
// entry per narrated chapter. The JSON is the portable artifact (it survives a
// re-zip); the stored form adds the byte range of each chapter and the archive.

/** Name of the manifest entry inside the pack zip. */
export const MANIFEST_ENTRY = "narration.json";

/** Manifest version this build understands. */
export const MANIFEST_VERSION = 1;

export interface NarrationManifestChapter {
  /** Zip entry holding this chapter's audio, e.g. "audio/001.ogg". */
  audio: string;
  /** Chapter audio length in seconds. */
  duration: number;
  /** Seconds into `audio` where each sentence unit starts. */
  starts: number[];
  /** Seconds into `audio` where each sentence unit ends. */
  ends: number[];
}

/** `narration.json`, written by `pnpm audiobook`. */
export interface NarrationManifest {
  version: typeof MANIFEST_VERSION;
  title: string;
  chapters: NarrationManifestChapter[];
}

/** One chapter of a pack that has been matched to its bytes in the archive. */
export interface NarrationChapter {
  offset: number;
  size: number;
  duration: number;
  starts: number[];
  ends: number[];
}

/** An imported pack, as stored in IndexedDB. */
export interface NarrationPack {
  version: typeof MANIFEST_VERSION;
  title: string;
  createdAt: number;
  chapters: NarrationChapter[];
  /** The pack zip, kept whole; chapters are read by byte range. */
  archive: Blob;
}

/** Bad or unsupported pack; `message` is safe to show. */
export class NarrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NarrationError";
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isSecond = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

/** Seconds, checked for the invariants playback relies on. */
function parseSeconds(value: unknown, where: string): number[] {
  if (!Array.isArray(value)) {
    throw new NarrationError(`${where}: expected an array of times`);
  }
  const times = value.map((item, index) => {
    if (!isSecond(item)) {
      throw new NarrationError(`${where}[${index}]: not a valid time`);
    }
    return item;
  });
  for (let index = 1; index < times.length; index += 1) {
    const previous = times[index - 1];
    const current = times[index];
    if (previous !== undefined && current !== undefined && current < previous) {
      throw new NarrationError(`${where}: times go backwards at ${index}`);
    }
  }
  return times;
}

function parseChapter(value: unknown, index: number): NarrationManifestChapter {
  const where = `chapters[${index}]`;
  if (!isRecord(value)) throw new NarrationError(`${where}: not an object`);
  const { audio, duration, starts, ends } = value;
  if (typeof audio !== "string") {
    throw new NarrationError(`${where}.audio: missing entry name`);
  }
  if (!isSecond(duration)) {
    throw new NarrationError(`${where}.duration: not a valid time`);
  }
  const startTimes = parseSeconds(starts, `${where}.starts`);
  const endTimes = parseSeconds(ends, `${where}.ends`);
  if (startTimes.length !== endTimes.length) {
    throw new NarrationError(
      `${where}: ${startTimes.length} starts but ${endTimes.length} ends`,
    );
  }
  // An empty `audio` marks a chapter the recording does not cover (front
  // matter, an author bio). Such a chapter carries no units.
  if (audio.length === 0 && startTimes.length > 0) {
    throw new NarrationError(`${where}: units without audio`);
  }
  for (let slot = 0; slot < startTimes.length; slot += 1) {
    const start = startTimes[slot];
    const end = endTimes[slot];
    if (start !== undefined && end !== undefined && end < start) {
      throw new NarrationError(`${where}: unit ${slot} ends before it starts`);
    }
  }
  return { audio, duration, starts: startTimes, ends: endTimes };
}

/** Validate an untrusted `narration.json`. Throws a `NarrationError`. */
export function parseManifest(value: unknown): NarrationManifest {
  if (!isRecord(value)) throw new NarrationError("not a narration manifest");
  if (value.version !== MANIFEST_VERSION) {
    throw new NarrationError(
      `unsupported narration version: ${String(value.version)}`,
    );
  }
  const title = typeof value.title === "string" ? value.title : "";
  if (!Array.isArray(value.chapters) || value.chapters.length === 0) {
    throw new NarrationError("manifest has no chapters");
  }
  return {
    version: MANIFEST_VERSION,
    title,
    chapters: value.chapters.map(parseChapter),
  };
}

/**
 * Chapter index and chapter-local unit index of a sentence unit. `firstUnits`
 * is `bookUnitStarts`: the first unit index of each chapter, ascending.
 */
export function locateUnit(
  firstUnits: readonly number[],
  unit: number,
): { chapter: number; local: number } | null {
  // At most a few hundred chapters: a scan beats a binary search for clarity.
  let chapter = -1;
  let start = 0;
  for (let index = 0; index < firstUnits.length; index += 1) {
    const candidate = firstUnits[index];
    if (candidate === undefined || candidate > unit) break;
    chapter = index;
    start = candidate;
  }
  return chapter < 0 ? null : { chapter, local: unit - start };
}
