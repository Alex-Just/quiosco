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
  markTtsProviderUnavailable,
  pickNextTtsChoice,
  type SkipableTtsProvider,
  type TtsChoice,
  type TtsChoiceRequest,
} from "./randomTts";
import {
  speakSentence as defaultSpeakSentence,
  ORIGINAL_LANG,
  type SpeakHandlers,
} from "./speech";
import type { EdgeVoiceSetting, TtsProvider } from "./types";

/** Cap random retries so a broken cloud stack cannot loop forever. */
const MAX_RANDOM_TTS_ATTEMPTS = 6;

export type SpeakWithVoiceArgs = {
  text: string;
  lang: string;
  token: string;
  ttsProvider: TtsProvider;
  edgeVoice: EdgeVoiceSetting;
  elevenLabsVoiceId: string;
  /** Speech rate multiplier; 1 is normal. */
  rate: number;
  /** Test seam for the session shuffle bag; returns the next pair to play. */
  pickTtsChoice?: (input: TtsChoiceRequest) => TtsChoice;
  /** Test seam: record a failed cloud provider for the session bag. */
  markTtsUnavailable?: (provider: SkipableTtsProvider) => void;
  handlers?: SpeakHandlers;
  speakSentence?: (
    text: string,
    lang: string,
    handlers?: SpeakHandlers,
    rate?: number,
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

function cloudTarget(
  choice: TtsChoice,
): { provider: SkipableTtsProvider; voice: string } | null {
  if (choice.ttsProvider === "edge") {
    return {
      provider: "edge",
      voice: edgeVoiceToEdgeName(choice.edgeVoice),
    };
  }
  if (
    choice.ttsProvider === "elevenlabs" &&
    choice.elevenLabsVoiceId.trim().length > 0
  ) {
    return {
      provider: "elevenlabs",
      voice: choice.elevenLabsVoiceId.trim(),
    };
  }
  return null;
}

/**
 * Prefer configured cloud TTS for es-ES; otherwise (or on failure) use
 * speechSynthesis. Stop/abort returns false without falling back to system.
 * Random mode retries the next bag voice after a cloud failure and skips
 * that provider for the rest of the page session.
 */
export async function speakWithVoice(
  args: SpeakWithVoiceArgs,
): Promise<boolean> {
  const speakSentence = args.speakSentence ?? defaultSpeakSentence;
  const fetchAudio = args.fetchTtsAudio ?? fetchTtsAudio;
  const playEdge = args.playEdgeAudio ?? playEdgeAudio;
  const handlers = args.handlers ?? {};
  const markUnavailable = args.markTtsUnavailable ?? markTtsProviderUnavailable;

  if (args.lang !== ORIGINAL_LANG || args.token.trim().length === 0) {
    return speakSentence(args.text, args.lang, handlers, args.rate);
  }

  const pickChoice = args.pickTtsChoice ?? pickNextTtsChoice;
  const random = args.ttsProvider === "random";
  const attempts = random ? MAX_RANDOM_TTS_ATTEMPTS : 1;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const choice: TtsChoice = random
      ? pickChoice({
          token: args.token,
          elevenLabsVoiceId: args.elevenLabsVoiceId,
        })
      : {
          ttsProvider:
            args.ttsProvider === "edge" || args.ttsProvider === "elevenlabs"
              ? args.ttsProvider
              : "system",
          edgeVoice: args.edgeVoice,
          elevenLabsVoiceId: args.elevenLabsVoiceId,
        };

    const target = cloudTarget(choice);
    if (!target) {
      return speakSentence(args.text, args.lang, handlers, args.rate);
    }

    stopEdgeAudio();
    const controller = new AbortController();
    beginEdgeFetch(controller);

    try {
      const blob = await fetchAudio(
        args.text,
        target.provider,
        target.voice,
        args.rate,
        args.token,
        controller.signal,
      );
      if (controller.signal.aborted) return false;
      releaseEdgeFetch();
      await playEdge(blob, handlers);
      return true;
    } catch (error) {
      releaseEdgeFetch();
      if (isAbortError(error) || controller.signal.aborted) return false;
      if (random) {
        markUnavailable(target.provider);
        continue;
      }
      return speakSentence(args.text, args.lang, handlers, args.rate);
    }
  }

  return speakSentence(args.text, args.lang, handlers, args.rate);
}
