import { useEffect } from "react";
import { stopSpeaking } from "./speech";
import type { SentenceMenu } from "./useSentenceSpeech";

const HINT_CLEAR_MS = 4000;

export function useSentenceSpeechLifecycle(): void {
  // Speech belongs to the page that started it: stop it on navigation and
  // when the visible text changes.
  useEffect(() => () => stopSpeaking(), []);
}

export function useSentenceMenuEscape(
  menu: SentenceMenu | null,
  setMenu: (menu: SentenceMenu | null) => void,
): void {
  useEffect(() => {
    if (menu) {
      const onKey = (event: KeyboardEvent) => {
        if (event.key === "Escape") setMenu(null);
      };
      window.addEventListener("keydown", onKey);
      return () => window.removeEventListener("keydown", onKey);
    }
  }, [menu, setMenu]);
}

export function useSpeechHintTimeout(
  hint: string | null,
  setHint: (hint: string | null) => void,
): void {
  useEffect(() => {
    if (hint) {
      const timer = window.setTimeout(() => setHint(null), HINT_CLEAR_MS);
      return () => window.clearTimeout(timer);
    }
  }, [hint, setHint]);
}
