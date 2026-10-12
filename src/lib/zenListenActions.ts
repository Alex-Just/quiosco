import {
  canSpeak as defaultCanSpeak,
  speakSentence as defaultSpeakSentence,
  stopSpeaking as defaultStopSpeaking,
  isCancellation,
  ORIGINAL_LANG,
  type SpeakHandlers,
} from "./speech";

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
  speakSentence?: (
    text: string,
    lang: string,
    handlers?: SpeakHandlers,
  ) => boolean;
  stopSpeaking?: () => void;
  originalLang?: string;
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
export function toggleZenOriginalListen(
  args: ToggleZenOriginalListenArgs,
): void {
  const canSpeak = args.canSpeak ?? defaultCanSpeak;
  const speakSentence = args.speakSentence ?? defaultSpeakSentence;
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
  if (!canSpeak()) {
    args.setHint("Text-to-speech is not available in this browser.");
    return;
  }

  args.speechRun.current += 1;
  const runId = args.speechRun.current;
  const started = speakSentence(text, originalLang, {
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
  });
  if (started) {
    args.setSpeaking({
      paragraph: args.paragraph,
      sentenceIndex: ZEN_PARAGRAPH_SPEECH_INDEX,
    });
  }
}
