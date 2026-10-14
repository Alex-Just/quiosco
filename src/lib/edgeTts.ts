import type { EdgeVoiceSetting } from "./types";

export const EDGE_VOICE_ELVIRA = "es-ES-ElviraNeural";
export const EDGE_VOICE_ALVARO = "es-ES-AlvaroNeural";

const TTS_CLIENT_TIMEOUT_MS = 45_000;

/** Map Settings edge voice to an Edge neural name. */
export function edgeVoiceToEdgeName(voice: EdgeVoiceSetting): string {
  return voice === "alvaro" ? EDGE_VOICE_ALVARO : EDGE_VOICE_ELVIRA;
}

export type FetchTtsAudio = (
  text: string,
  provider: "edge" | "elevenlabs",
  voice: string,
  rate: number,
  token: string,
  signal?: AbortSignal,
) => Promise<Blob>;

/** Fetch MP3 audio from the Worker TTS proxy (Edge or ElevenLabs). */
export async function fetchTtsAudio(
  text: string,
  provider: "edge" | "elevenlabs",
  voice: string,
  rate: number,
  token: string,
  signal?: AbortSignal,
  fetchFn: typeof fetch = fetch,
): Promise<Blob> {
  const timeout = AbortSignal.timeout(TTS_CLIENT_TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;

  const response = await fetchFn("/api/tts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text, provider, voice, rate }),
    signal: combined,
  });
  if (!response.ok) {
    throw new Error(`TTS request failed: ${response.status}`);
  }
  return response.blob();
}

/** @deprecated Use fetchTtsAudio with provider "edge". */
export async function fetchEdgeTtsAudio(
  text: string,
  edgeVoice: string,
  token: string,
  signal?: AbortSignal,
  fetchFn: typeof fetch = fetch,
): Promise<Blob> {
  return fetchTtsAudio(text, "edge", edgeVoice, 1, token, signal, fetchFn);
}

/** @deprecated Use edgeVoiceToEdgeName. */
export function settingsVoiceToEdgeName(
  voice: "system" | "elvira" | "alvaro",
): string | null {
  if (voice === "system") return null;
  return edgeVoiceToEdgeName(voice === "alvaro" ? "alvaro" : "elvira");
}
