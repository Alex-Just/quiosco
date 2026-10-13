import type { VoiceSetting } from "./types";

export const EDGE_VOICE_ELVIRA = "es-ES-ElviraNeural";
export const EDGE_VOICE_ALVARO = "es-ES-AlvaroNeural";

const TTS_CLIENT_TIMEOUT_MS = 45_000;

/** Map Settings voice to an Edge neural name, or null for system TTS. */
export function settingsVoiceToEdgeName(voice: VoiceSetting): string | null {
  if (voice === "elvira") return EDGE_VOICE_ELVIRA;
  if (voice === "alvaro") return EDGE_VOICE_ALVARO;
  return null;
}

export type FetchEdgeTtsAudio = (
  text: string,
  edgeVoice: string,
  token: string,
  signal?: AbortSignal,
) => Promise<Blob>;

/** Fetch MP3 audio for one utterance from the Worker Edge proxy. */
export async function fetchEdgeTtsAudio(
  text: string,
  edgeVoice: string,
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
    body: JSON.stringify({ text, voice: edgeVoice }),
    signal: combined,
  });
  if (!response.ok) {
    throw new Error(`Edge TTS request failed: ${response.status}`);
  }
  return response.blob();
}
