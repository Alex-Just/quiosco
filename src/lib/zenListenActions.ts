import { loadSettings } from "./settings";
import { speakWithVoice } from "./speakWithVoice";
import {
  canSpeak as defaultCanSpeak,
  speakSentence as defaultSpeakSentence,
  stopSpeaking as defaultStopSpeaking,
  isCancellation,
  ORIGINAL_LANG,
  type SpeakHandlers,
} from "./speech";
import type { VoiceSetting } from "./types";

/** sentenceIndex marker meaning the whole Zen paragraph is speaking. */
export const ZEN_PARAGRAPH_SPEECH_INDEX = -1;

type SpeakingRef = { paragraph: number; sentenceIndex: number } | null;

export type ToggleZenOriginalListenArgs = {
  paragraph: number;
  text: string;
  speaking: SpeakingRef;
  speechRun: { current: number };
  setSpeaking: (value: SpeakingRef) => void;
  setHint: (hint: string | null) => void;
  canSpeak?: () => boolean;
  /** Test seam: sync system speak. Production uses speakWithVoice. */
  speakSentence?: (
    text: string,
    lang: string,
    handlers?: SpeakHandlers,
  ) => boolean;
  speakWithVoiceFn?: typeof speakWithVoice;
  stopSpeaking?: () => void;
  originalLang?: string;
  voice?: VoiceSetting;
  token?: string;
};

export function isZenOriginalListening(
  speaking: SpeakingRef,
  paragraph: number,
): boolean {
  return (
    speaking?.paragraph === paragraph &&
    speaking.sentenceIndex === ZEN_PARAGRAPH_SPEECH_INDEX
  );
}

/** Toggle TTS for the original text of the current Zen paragraph. */
export async function toggleZenOriginalListen(
  args: ToggleZenOriginalListenArgs,
): Promise<void> {
  const canSpeak = args.canSpeak ?? defaultCanSpeak;
  const stopSpeaking = args.stopSpeaking ?? defaultStopSpeaking;
  const originalLang = args.originalLang ?? ORIGINAL_LANG;
  const text = args.text.trim();

  if (isZenOriginalListening(args.speaking, args.paragraph)) {
    args.speechRun.current += 1;
    stopSpeaking();
    args.setSpeaking(null);
    return;
  }
  if (!text) return;

  const settings =
    args.voice === undefined || args.token === undefined
      ? loadSettings()
      : null;
  const voice = args.voice ?? settings?.voice ?? "system";
  const token = args.token ?? settings?.appToken ?? "";
  const edgePreferred = voice !== "system" && token.trim().length > 0;
  if (!canSpeak() && !edgePreferred) {
    args.setHint("Text-to-speech is not available in this browser.");
    return;
  }

  args.speechRun.current += 1;
  const runId = args.speechRun.current;
  const handlers: SpeakHandlers = {
    onEnd: () => {
      if (args.speechRun.current === runId) args.setSpeaking(null);
    },
    onError: (reason) => {
      if (args.speechRun.current !== runId) return;
      args.setSpeaking(null);
      if (!isCancellation(reason)) {
        args.setHint("Could not play this sentence with the system voice.");
      }
    },
  };

  // Mark speaking before the Edge fetch so Stop works during synthesis.
  args.setSpeaking({
    paragraph: args.paragraph,
    sentenceIndex: ZEN_PARAGRAPH_SPEECH_INDEX,
  });

  let started = false;
  if (args.speakSentence) {
    started = args.speakSentence(text, originalLang, handlers);
  } else {
    const speak = args.speakWithVoiceFn ?? speakWithVoice;
    started = await speak({
      text,
      lang: originalLang,
      token,
      voice,
      handlers,
      speakSentence: defaultSpeakSentence,
    });
  }

  if (
    (!started || args.speechRun.current !== runId) &&
    args.speechRun.current === runId
  ) {
    args.setSpeaking(null);
  }
}
