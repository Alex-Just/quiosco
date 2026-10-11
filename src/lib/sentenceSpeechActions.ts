import { loadSettings } from "./settings";
import {
  canSpeak,
  isCancellation,
  ORIGINAL_LANG,
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
};

export function listenToSentence(ctx: ListenToSentenceContext): void {
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
  if (!canSpeak()) {
    setHint("Text-to-speech is not available in this browser.");
    return;
  }
  const settings = loadSettings();
  const lang =
    view === "translation"
      ? speechLangFor(settings.targetLanguage)
      : ORIGINAL_LANG;
  speechRun.current += 1;
  const runId = speechRun.current;
  const started = speakSentence(sentence, lang, {
    onEnd: () => {
      if (speechRun.current === runId) setSpeaking(null);
    },
    onError: (reason) => {
      if (speechRun.current !== runId) return;
      setSpeaking(null);
      if (!isCancellation(reason)) {
        setHint("Could not play this sentence with the system voice.");
      }
    },
  });
  setMenu(null);
  if (started) setSpeaking({ paragraph, sentenceIndex });
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
