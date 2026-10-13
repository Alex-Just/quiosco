type EdgeHandlers = {
  onEnd?: () => void;
  onError?: (reason: string) => void;
};

type EdgePlayback = {
  audio: HTMLAudioElement;
  objectUrl: string;
};

let current: EdgePlayback | null = null;
let fetchAbort: AbortController | null = null;

/** Abort any in-flight /api/tts fetch. */
export function abortEdgeFetch(): void {
  fetchAbort?.abort();
  fetchAbort = null;
}

/** Track the AbortController for the current Edge TTS request. */
export function beginEdgeFetch(controller: AbortController): void {
  abortEdgeFetch();
  fetchAbort = controller;
}

/** Drop the fetch controller without aborting (fetch already finished). */
export function releaseEdgeFetch(): void {
  fetchAbort = null;
}

/** Stop any in-flight Edge fetch / HTMLAudioElement playback. */
export function stopEdgeAudio(): void {
  abortEdgeFetch();
  if (!current) return;
  current.audio.pause();
  current.audio.removeAttribute("src");
  current.audio.load();
  URL.revokeObjectURL(current.objectUrl);
  current = null;
}

/**
 * Start playing an Edge MP3 blob. Resolves when playback has started
 * (not when it ends); onEnd/onError fire later via handlers.
 */
export async function playEdgeAudio(
  blob: Blob,
  handlers: EdgeHandlers = {},
): Promise<void> {
  stopEdgeAudio();
  const objectUrl = URL.createObjectURL(blob);
  const audio = new Audio(objectUrl);
  current = { audio, objectUrl };

  audio.onended = () => {
    if (current?.audio === audio) {
      URL.revokeObjectURL(objectUrl);
      current = null;
    }
    handlers.onEnd?.();
  };
  audio.onerror = () => {
    if (current?.audio === audio) {
      URL.revokeObjectURL(objectUrl);
      current = null;
    }
    handlers.onError?.("synthesis-failed");
  };

  await audio.play();
}
