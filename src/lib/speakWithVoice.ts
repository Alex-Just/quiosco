import {
  beginEdgeFetch,
  playEdgeAudio,
  releaseEdgeFetch,
  stopEdgeAudio,
} from "./edgeAudio";
import {
  edgeVoiceToEdgeName,
  type FetchTtsAudio,
  fetchTtsAudio,
} from "./edgeTts";
import {
  speakSentence as defaultSpeakSentence,
  ORIGINAL_LANG,
  type SpeakHandlers,
} from "./speech";
import type { EdgeVoiceSetting, TtsProvider } from "./types";

export type SpeakWithVoiceArgs = {
  text: string;
  lang: string;
  token: string;
  ttsProvider: TtsProvider;
  edgeVoice: EdgeVoiceSetting;
  elevenLabsVoiceId: string;
  handlers?: SpeakHandlers;
  speakSentence?: (
    text: string,
    lang: string,
    handlers?: SpeakHandlers,
  ) => boolean;
  fetchTtsAudio?: FetchTtsAudio;
  playEdgeAudio?: (blob: Blob, handlers?: SpeakHandlers) => Promise<void>;
};

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

/**
 * Prefer configured cloud TTS for es-ES; otherwise (or on failure) use
 * speechSynthesis. Stop/abort returns false without falling back to system.
 */
export async function speakWithVoice(
  args: SpeakWithVoiceArgs,
): Promise<boolean> {
  const speakSentence = args.speakSentence ?? defaultSpeakSentence;
  const fetchAudio = args.fetchTtsAudio ?? fetchTtsAudio;
  const playEdge = args.playEdgeAudio ?? playEdgeAudio;
  const handlers = args.handlers ?? {};

  if (args.lang !== ORIGINAL_LANG || args.token.trim().length === 0) {
    return speakSentence(args.text, args.lang, handlers);
  }

  let provider: "edge" | "elevenlabs" | null = null;
  let voice = "";
  if (args.ttsProvider === "edge") {
    provider = "edge";
    voice = edgeVoiceToEdgeName(args.edgeVoice);
  } else if (
    args.ttsProvider === "elevenlabs" &&
    args.elevenLabsVoiceId.trim().length > 0
  ) {
    provider = "elevenlabs";
    voice = args.elevenLabsVoiceId.trim();
  }

  if (!provider) {
    return speakSentence(args.text, args.lang, handlers);
  }

  stopEdgeAudio();
  const controller = new AbortController();
  beginEdgeFetch(controller);

  try {
    const blob = await fetchAudio(
      args.text,
      provider,
      voice,
      args.token,
      controller.signal,
    );
    if (controller.signal.aborted) return false;
    releaseEdgeFetch();
    await playEdge(blob, handlers);
    return true;
  } catch (error) {
    if (isAbortError(error) || controller.signal.aborted) return false;
    return speakSentence(args.text, args.lang, handlers);
  }
}
