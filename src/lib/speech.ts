import { stopEdgeAudio } from "./edgeAudio";

// Thin wrapper over the Web Speech API. On Android Chrome (including the
// installed PWA) speechSynthesis is backed by the device's TTS engines.
// Voice lists can load asynchronously; we set `lang`, and when the OS marks a
// matching voice as default we bind that one so Preferred engine is respected.
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

type SpeechVoiceLike = Pick<SpeechSynthesisVoice, "name" | "lang" | "default">;

function voiceMatchesLang(voiceLang: string, want: string): boolean {
  if (!want) return false;
  const voice = voiceLang.toLowerCase();
  const need = want.toLowerCase();
  if (voice === need) return true;
  const needPrimary = need.split("-")[0] ?? need;
  return voice.startsWith(`${needPrimary}-`) || voice === needPrimary;
}

/**
 * Prefer the OS-default voice for `lang` when Chrome lists one.
 * Returns null otherwise so utterance.lang alone lets Preferred engine choose.
 * Do not pin Google (or any other engine) by name — that ignores the user's
 * system TTS setting.
 */
export function pickSpeechVoice(
  lang: string,
  voices: readonly SpeechVoiceLike[],
): SpeechVoiceLike | null {
  if (!lang || voices.length === 0) return null;
  return (
    voices.find(
      (voice) => voice.default && voiceMatchesLang(voice.lang, lang),
    ) ?? null
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
