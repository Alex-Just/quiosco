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
  pickNextTtsChoice,
  type TtsChoice,
  type TtsChoiceRequest,
} from "./randomTts";
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
  /** Speech rate multiplier; 1 is normal. */
  rate: number;
  /** When true, pick a random provider and voice for this play. */
  ttsRandom?: boolean;
  /** Test seam for the session shuffle bag; returns the next pair to play. */
  pickTtsChoice?: (input: TtsChoiceRequest) => TtsChoice;
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
    return speakSentence(args.text, args.lang, handlers, args.rate);
  }

  const choice = args.ttsRandom
    ? (args.pickTtsChoice ?? pickNextTtsChoice)({
        token: args.token,
        elevenLabsVoiceId: args.elevenLabsVoiceId,
      })
    : {
        ttsProvider: args.ttsProvider,
        edgeVoice: args.edgeVoice,
        elevenLabsVoiceId: args.elevenLabsVoiceId,
      };

  let provider: "edge" | "elevenlabs" | null = null;
  let voice = "";
  if (choice.ttsProvider === "edge") {
    provider = "edge";
    voice = edgeVoiceToEdgeName(choice.edgeVoice);
  } else if (
    choice.ttsProvider === "elevenlabs" &&
    choice.elevenLabsVoiceId.trim().length > 0
  ) {
    provider = "elevenlabs";
    voice = choice.elevenLabsVoiceId.trim();
  }

  if (!provider) {
    return speakSentence(args.text, args.lang, handlers, args.rate);
  }

  stopEdgeAudio();
  const controller = new AbortController();
  beginEdgeFetch(controller);

  try {
    const blob = await fetchAudio(
      args.text,
      provider,
      voice,
      args.rate,
      args.token,
      controller.signal,
    );
    if (controller.signal.aborted) return false;
    releaseEdgeFetch();
    await playEdge(blob, handlers);
    return true;
  } catch (error) {
    if (isAbortError(error) || controller.signal.aborted) return false;
    return speakSentence(args.text, args.lang, handlers, args.rate);
  }
}
