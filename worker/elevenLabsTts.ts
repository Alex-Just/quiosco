/** ElevenLabs Turbo v2.5 TTS via the official REST API. */

export const ELEVENLABS_MODEL_ID = "eleven_turbo_v2_5";
export const ELEVENLABS_LANGUAGE_CODE = "es";
export const ELEVENLABS_OUTPUT_FORMAT = "mp3_44100_128";
const ELEVENLABS_TTS_URL = "https://api.elevenlabs.io/v1/text-to-speech";

export type ElevenLabsFetch = typeof fetch;

async function elevenLabsErrorDetail(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (body !== null && typeof body === "object" && "detail" in body) {
      const detail = (body as { detail: unknown }).detail;
      if (typeof detail === "string") return detail;
      if (detail !== null && typeof detail === "object") {
        const record = detail as { message?: unknown; code?: unknown };
        if (typeof record.message === "string") {
          const code =
            typeof record.code === "string" ? ` (${record.code})` : "";
          return `${record.message}${code}`;
        }
      }
    }
  } catch {
    // Ignore non-JSON error bodies.
  }
  return `HTTP ${response.status}`;
}

/**
 * Synthesize MP3 with ElevenLabs Turbo v2.5 (Spanish language code).
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

  const url =
    `${ELEVENLABS_TTS_URL}/${encodeURIComponent(id)}` +
    `?output_format=${encodeURIComponent(ELEVENLABS_OUTPUT_FORMAT)}`;

  const response = await fetchFn(url, {
    method: "POST",
    headers: {
      "xi-api-key": key,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text,
      model_id: ELEVENLABS_MODEL_ID,
      language_code: ELEVENLABS_LANGUAGE_CODE,
    }),
  });
  if (!response.ok) {
    const detail = await elevenLabsErrorDetail(response);
    throw new Error(`ElevenLabs TTS failed: ${response.status} — ${detail}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}
