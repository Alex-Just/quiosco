/** ElevenLabs Flash v2.5 TTS via the official REST API. */

export const ELEVENLABS_MODEL_ID = "eleven_flash_v2_5";
const ELEVENLABS_TTS_URL = "https://api.elevenlabs.io/v1/text-to-speech";

export type ElevenLabsFetch = typeof fetch;

/**
 * Synthesize MP3 with ElevenLabs Flash v2.5.
 * Throws when the API key is missing or the upstream request fails.
 */
export async function synthesizeElevenLabsMp3(
  text: string,
  voiceId: string,
  apiKey: string,
  fetchFn: ElevenLabsFetch = fetch,
): Promise<Uint8Array> {
  const key = apiKey.trim();
  if (!key) throw new Error("ELEVENLABS_API_KEY missing");
  const id = voiceId.trim();
  if (!id) throw new Error("ElevenLabs voice id empty");

  const response = await fetchFn(
    `${ELEVENLABS_TTS_URL}/${encodeURIComponent(id)}`,
    {
      method: "POST",
      headers: {
        "xi-api-key": key,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: ELEVENLABS_MODEL_ID,
      }),
    },
  );
  if (!response.ok) {
    throw new Error(`ElevenLabs TTS failed: ${response.status}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}
