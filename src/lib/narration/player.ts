// Play one sentence range out of a stored narration archive.
//
// The archive is sliced by byte range into a Blob, so a chapter's audio is
// never materialised in JS memory: the browser reads the range it needs and
// seeks inside it. One segment plays at a time, mirroring `edgeAudio`.

import type { NarrationChapter, NarrationPack } from "./manifest";

export type NarrationPlaybackHandlers = {
  onEnd?: () => void;
  onError?: (reason: string) => void;
};

type ActivePlayback = {
  audio: HTMLAudioElement;
  url: string;
};

let current: ActivePlayback | null = null;

/** Release the active element, its object URL, and its source. */
function release(playback: ActivePlayback): void {
  playback.audio.onended = null;
  playback.audio.onerror = null;
  playback.audio.ontimeupdate = null;
  playback.audio.pause();
  playback.audio.removeAttribute("src");
  playback.audio.load();
  URL.revokeObjectURL(playback.url);
}

/** Stop whatever narration is playing. Safe to call at any time. */
export function stopNarration(): void {
  if (!current) return;
  release(current);
  current = null;
}

/** A short silence still needs a duration the audio clock can cross. */
const MIN_SEGMENT_SECONDS = 0.25;

function seek(audio: HTMLAudioElement, time: number): Promise<void> {
  return new Promise((resolve) => {
    const jump = () => {
      audio.currentTime = time;
      resolve();
    };
    // 1 = HAVE_METADATA, the first state where currentTime is writable.
    if (audio.readyState >= 1) {
      jump();
      return;
    }
    // Resolve on error too: the element's own handler reports the failure,
    // and a hung seek would strand the caller's promise.
    audio.addEventListener("loadedmetadata", jump, { once: true });
    audio.addEventListener("error", () => resolve(), { once: true });
  });
}

/**
 * Play `start`..`end` of one chapter. Resolves when playback has started; the
 * handlers fire later. Throws when the browser refuses to start, so the caller
 * can fall back to synthesized speech.
 */
export async function playNarrationSegment(
  pack: NarrationPack,
  chapter: NarrationChapter,
  start: number,
  end: number,
  handlers: NarrationPlaybackHandlers = {},
): Promise<void> {
  stopNarration();

  const url = URL.createObjectURL(
    pack.archive.slice(chapter.offset, chapter.offset + chapter.size),
  );
  const audio = new Audio(url);
  audio.preload = "auto";
  const playback: ActivePlayback = { audio, url };
  current = playback;

  const finish = (failed: boolean) => {
    if (current !== playback) return;
    release(playback);
    current = null;
    if (failed) handlers.onError?.("narration-failed");
    else handlers.onEnd?.();
  };

  audio.onended = () => finish(false);
  audio.onerror = () => finish(true);

  const from = Math.max(
    0,
    Math.min(start, Math.max(0, chapter.duration - 0.1)),
  );
  const to = Math.max(end, from + MIN_SEGMENT_SECONDS);

  try {
    await seek(audio, from);
    if (current !== playback) return;
    // The element keeps playing past the sentence's end unless stopped; this
    // is what turns a chapter file into a single sentence.
    audio.ontimeupdate = () => {
      if (audio.currentTime >= to) finish(false);
    };
    await audio.play();
  } catch (error) {
    if (current === playback) finish(true);
    throw error;
  }
}
