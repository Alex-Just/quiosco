import { loadSettings } from "./settings";
import { speakWithVoice } from "./speakWithVoice";
import {
  canSpeak,
  isCancellation,
  ORIGINAL_LANG,
  type SpeakHandlers,
  speakSentence,
  speechLangFor,
  stopSpeaking,
} from "./speech";
import type { ArticleView } from "./types";
import type { SentenceMenu } from "./useSentenceSpeech";

type SpeakingRef = { paragraph: number; sentenceIndex: number } | null;

export function sentenceIsSpeaking(
  speaking: SpeakingRef,
  paragraph: number,
  sentenceIndex: number,
): boolean {
  return (
    speaking?.paragraph === paragraph &&
    speaking.sentenceIndex === sentenceIndex
  );
}

export type ListenToSentenceContext = {
  menu: SentenceMenu;
  view: ArticleView;
  speaking: SpeakingRef;
  speechRun: { current: number };
  setSpeaking: (value: SpeakingRef) => void;
  setMenu: (menu: SentenceMenu | null) => void;
  setHint: (hint: string | null) => void;
  speakWithVoiceFn?: typeof speakWithVoice;
};

export async function listenToSentence(
  ctx: ListenToSentenceContext,
): Promise<void> {
  const { menu, view, speaking, speechRun, setSpeaking, setMenu, setHint } =
    ctx;
  const { paragraph, sentenceIndex, sentence } = menu;
  if (sentenceIsSpeaking(speaking, paragraph, sentenceIndex)) {
    speechRun.current += 1;
    stopSpeaking();
    setSpeaking(null);
    setMenu(null);
    return;
  }
  const settings = loadSettings();
  const lang =
    view === "translation"
      ? speechLangFor(settings.targetLanguage)
      : ORIGINAL_LANG;
  const cloudPreferred =
    settings.ttsProvider !== "system" &&
    lang === ORIGINAL_LANG &&
    settings.appToken.trim().length > 0 &&
    (settings.ttsProvider !== "elevenlabs" ||
      settings.elevenLabsVoiceId.trim().length > 0);
  if (!canSpeak() && !cloudPreferred) {
    setHint("Text-to-speech is not available in this browser.");
    return;
  }
  speechRun.current += 1;
  const runId = speechRun.current;
  const handlers: SpeakHandlers = {
    onEnd: () => {
      if (speechRun.current === runId) setSpeaking(null);
    },
    onError: (reason) => {
      if (speechRun.current !== runId) return;
      setSpeaking(null);
      if (!isCancellation(reason)) {
        setHint("Could not play this sentence.");
      }
    },
  };
  setMenu(null);
  setSpeaking({ paragraph, sentenceIndex });

  const speak = ctx.speakWithVoiceFn ?? speakWithVoice;
  const started = await speak({
    text: sentence,
    lang,
    token: settings.appToken,
    ttsProvider: settings.ttsProvider,
    edgeVoice: settings.edgeVoice,
    elevenLabsVoiceId: settings.elevenLabsVoiceId,
    rate: settings.ttsRate,
    handlers,
    speakSentence,
  });
  if (
    (!started || speechRun.current !== runId) &&
    speechRun.current === runId
  ) {
    setSpeaking(null);
  }
}

export async function copySentenceToClipboard(
  sentence: string,
  setHint: (hint: string | null) => void,
): Promise<void> {
  try {
    await navigator.clipboard.writeText(sentence);
    setHint("Copied. Tap the Google Translate bubble to open it there.");
  } catch {
    setHint("Could not copy the sentence.");
  }
}

export function stopSpeechForViewChange(
  speechRun: { current: number },
  setSpeaking: (value: SpeakingRef) => void,
  setMenu: (menu: SentenceMenu | null) => void,
): void {
  // Speech indexes the old text; stop it when the visible text changes.
  speechRun.current += 1;
  stopSpeaking();
  setSpeaking(null);
  setMenu(null);
}
