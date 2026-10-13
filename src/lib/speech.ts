import { stopEdgeAudio } from "./edgeAudio";

// Thin wrapper over the Web Speech API. On Android Chrome (including the
// installed PWA) speechSynthesis is backed by the device's selected TTS
// engine, so no extra permissions or services are involved. Voice lists load
// asynchronously, so we set `lang` and let the browser pick a matching voice,
// surfacing failures through onError instead of failing silently.
// stopSpeaking also clears Edge HTMLAudioElement playback from speakWithVoice.
export const ORIGINAL_LANG = "es-ES";

const LANGUAGE_CODES: Record<string, string> = {
  english: "en-US",
  spanish: "es-ES",
  español: "es-ES",
  ingles: "en-US",
  inglés: "en-US",
  french: "fr-FR",
  francés: "fr-FR",
  frances: "fr-FR",
  german: "de-DE",
  alemán: "de-DE",
  aleman: "de-DE",
  italian: "it-IT",
  italiano: "it-IT",
  portuguese: "pt-PT",
  portugués: "pt-PT",
  portugues: "pt-PT",
  catalan: "ca-ES",
  catalán: "ca-ES",
  català: "ca-ES",
  galician: "gl-ES",
  gallego: "gl-ES",
  galego: "gl-ES",
  basque: "eu-ES",
  euskera: "eu-ES",
  euskara: "eu-ES",
};

export function speechLangFor(language: string): string {
  return LANGUAGE_CODES[language.trim().toLowerCase()] ?? "";
}

export function canSpeak(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

// Cancellations are expected (stop button, replaced utterance, Android maps
// pause() to cancel()); they must not surface as "no voice" failures.
export function isCancellation(reason: string): boolean {
  return reason === "canceled" || reason === "interrupted";
}

export interface SpeakHandlers {
  onEnd?: () => void;
  onError?: (reason: string) => void;
}

export function speakSentence(
  text: string,
  lang: string,
  handlers: SpeakHandlers = {},
): boolean {
  if (!canSpeak()) return false;
  const synth = window.speechSynthesis;
  synth.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  if (lang) utterance.lang = lang;
  utterance.onend = () => handlers.onEnd?.();
  utterance.onerror = (event) => handlers.onError?.(event.error);
  synth.speak(utterance);
  return true;
}

export function stopSpeaking(): void {
  stopEdgeAudio();
  if (canSpeak()) window.speechSynthesis.cancel();
}
