import { stopEdgeAudio } from "./edgeAudio";

// Thin wrapper over the Web Speech API. On Android Chrome (including the
// installed PWA) speechSynthesis is backed by the device's TTS engines.
// Voice lists can load asynchronously; we still set `lang`, and when Castilian
// Google voices are already listed we bind one explicitly.
// stopSpeaking also clears Edge HTMLAudioElement playback from speakWithVoice.
export const ORIGINAL_LANG = "es-ES";

/** Android Chrome Castilian network voice (better than many device defaults). */
export const GOOGLE_ES_VOICE_NAME = "Google español";
const GOOGLE_VOICE_NAME_MARKER = "Google";

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

type SpeechVoiceLike = Pick<SpeechSynthesisVoice, "name" | "lang">;

function isCastilianLang(lang: string): boolean {
  return lang === ORIGINAL_LANG || lang.toLowerCase().startsWith("es-es");
}

/**
 * Prefer Android's "Google español" (es-ES) when speaking Castilian.
 * Returns null when no matching voice is listed yet.
 */
export function pickSpeechVoice(
  lang: string,
  voices: readonly SpeechVoiceLike[],
): SpeechVoiceLike | null {
  if (!isCastilianLang(lang) || voices.length === 0) return null;
  const castilian = voices.filter((voice) => isCastilianLang(voice.lang));
  const exact = castilian.find((voice) => voice.name === GOOGLE_ES_VOICE_NAME);
  if (exact) return exact;
  return (
    castilian.find((voice) => voice.name.includes(GOOGLE_VOICE_NAME_MARKER)) ??
    null
  );
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
  const voices = synth.getVoices();
  const preferred = pickSpeechVoice(lang, voices);
  if (preferred) {
    const live = voices.find(
      (voice) => voice.name === preferred.name && voice.lang === preferred.lang,
    );
    if (live) utterance.voice = live;
  }
  utterance.onend = () => handlers.onEnd?.();
  utterance.onerror = (event) => handlers.onError?.(event.error);
  synth.speak(utterance);
  return true;
}

export function stopSpeaking(): void {
  stopEdgeAudio();
  if (canSpeak()) window.speechSynthesis.cancel();
}
