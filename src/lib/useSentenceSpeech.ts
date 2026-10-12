import { useRef, useState } from "react";
import {
  copySentenceToClipboard,
  listenToSentence,
  stopSpeechForViewChange as resetSpeechForViewChange,
  sentenceIsSpeaking,
} from "./sentenceSpeechActions";
import type { ArticleView } from "./types";
import {
  useSentenceMenuEscape,
  useSentenceSpeechLifecycle,
  useSpeechHintTimeout,
} from "./useSentenceSpeechEffects";
import {
  isZenOriginalListening,
  toggleZenOriginalListen,
} from "./zenListenActions";

export type SentenceMenu = {
  paragraph: number;
  sentenceIndex: number;
  sentence: string;
};

export function useSentenceSpeech(view: ArticleView): {
  menu: SentenceMenu | null;
  setMenu: (menu: SentenceMenu | null) => void;
  hint: string | null;
  isSpeaking: (paragraph: number, sentenceIndex: number) => boolean;
  isZenOriginalSpeaking: (paragraph: number) => boolean;
  onListen: () => void;
  onListenZenOriginal: (paragraph: number, text: string) => void;
  onCopySentence: () => void;
  stopSpeechForViewChange: () => void;
} {
  const [menu, setMenu] = useState<SentenceMenu | null>(null);
  const [speaking, setSpeaking] = useState<{
    paragraph: number;
    sentenceIndex: number;
  } | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  // Invalidates stale utterance callbacks: a replaced or cancelled utterance
  // may still fire end/error, and those must not clear the new highlight.
  const speechRun = useRef(0);

  useSentenceSpeechLifecycle();
  useSentenceMenuEscape(menu, setMenu);
  useSpeechHintTimeout(hint, setHint);

  const isSpeaking = (paragraph: number, sentenceIndex: number) =>
    sentenceIsSpeaking(speaking, paragraph, sentenceIndex);

  const isZenOriginalSpeaking = (paragraph: number) =>
    isZenOriginalListening(speaking, paragraph);

  const onListen = () => {
    if (menu) {
      listenToSentence({
        menu,
        view,
        speaking,
        speechRun,
        setSpeaking,
        setMenu,
        setHint,
      });
    }
  };

  const onListenZenOriginal = (paragraph: number, text: string) => {
    toggleZenOriginalListen({
      paragraph,
      text,
      speaking,
      speechRun,
      setSpeaking,
      setHint,
    });
  };

  const onCopySentence = () => {
    if (menu) {
      const sentence = menu.sentence;
      setMenu(null);
      void copySentenceToClipboard(sentence, setHint);
    }
  };

  const stopSpeechForViewChange = () => {
    resetSpeechForViewChange(speechRun, setSpeaking, setMenu);
  };

  return {
    menu,
    setMenu,
    hint,
    isSpeaking,
    isZenOriginalSpeaking,
    onListen,
    onListenZenOriginal,
    onCopySentence,
    stopSpeechForViewChange,
  };
}
