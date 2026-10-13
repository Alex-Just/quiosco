import {
  beginEdgeFetch,
  playEdgeAudio,
  releaseEdgeFetch,
  stopEdgeAudio,
} from "./edgeAudio";
import {
  type FetchEdgeTtsAudio,
  fetchEdgeTtsAudio,
  settingsVoiceToEdgeName,
} from "./edgeTts";
import {
  speakSentence as defaultSpeakSentence,
  ORIGINAL_LANG,
  type SpeakHandlers,
} from "./speech";
import type { VoiceSetting } from "./types";

export type SpeakWithVoiceArgs = {
  text: string;
  lang: string;
  token: string;
  voice: VoiceSetting;
  handlers?: SpeakHandlers;
  speakSentence?: (
    text: string,
    lang: string,
    handlers?: SpeakHandlers,
  ) => boolean;
  fetchEdgeAudio?: FetchEdgeTtsAudio;
  playEdgeAudio?: (blob: Blob, handlers?: SpeakHandlers) => Promise<void>;
};

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

/**
 * Prefer Edge neural Castilian when configured; otherwise (or on failure)
 * use the device speechSynthesis engine. Returns when playback has started.
 * Stop/abort returns false without falling back to system TTS.
 */
export async function speakWithVoice(
  args: SpeakWithVoiceArgs,
): Promise<boolean> {
  const speakSentence = args.speakSentence ?? defaultSpeakSentence;
  const fetchEdge = args.fetchEdgeAudio ?? fetchEdgeTtsAudio;
  const playEdge = args.playEdgeAudio ?? playEdgeAudio;
  const handlers = args.handlers ?? {};
  const edgeName = settingsVoiceToEdgeName(args.voice);
  const canUseEdge =
    edgeName !== null &&
    args.lang === ORIGINAL_LANG &&
    args.token.trim().length > 0;

  if (!canUseEdge) {
    return speakSentence(args.text, args.lang, handlers);
  }

  stopEdgeAudio();
  const controller = new AbortController();
  beginEdgeFetch(controller);

  try {
    const blob = await fetchEdge(
      args.text,
      edgeName,
      args.token,
      controller.signal,
    );
    if (controller.signal.aborted) return false;
    releaseEdgeFetch();
    await playEdge(blob, handlers);
    return true;
  } catch (error) {
    if (isAbortError(error) || controller.signal.aborted) return false;
    // Silent fallback per design: Edge is best-effort.
    return speakSentence(args.text, args.lang, handlers);
  }
}
