import { synthesizeEdgeMp3 } from "./edgeTtsClient";
import { jsonResponse } from "./headers";

export const EDGE_VOICE_ELVIRA = "es-ES-ElviraNeural";
export const EDGE_VOICE_ALVARO = "es-ES-AlvaroNeural";

/** One Zen page / sentence unit; reject whole-book dumps. */
export const MAX_TTS_TEXT_CHARS = 4000;

const ALLOWED_VOICES = new Set([EDGE_VOICE_ELVIRA, EDGE_VOICE_ALVARO]);

export type TtsSynthesize = (
  text: string,
  voice: string,
) => Promise<Uint8Array>;

export type HandleTtsOptions = {
  synthesize?: TtsSynthesize;
};

type TtsPayload = {
  text: string;
  voice: string;
};

async function readPayload(request: Request): Promise<TtsPayload | Response> {
  let data: unknown;
  try {
    data = await request.json();
  } catch {
    return jsonResponse({ error: "invalid request" }, 400);
  }
  if (data === null || typeof data !== "object") {
    return jsonResponse({ error: "invalid request" }, 400);
  }
  const body = data as Partial<TtsPayload>;
  if (typeof body.text !== "string" || typeof body.voice !== "string") {
    return jsonResponse({ error: "invalid request" }, 400);
  }
  return { text: body.text, voice: body.voice };
}

/** Authenticated Edge TTS proxy: Castilian Elvira / Álvaro only. */
export async function handleTts(
  request: Request,
  options: HandleTtsOptions = {},
): Promise<Response> {
  const payload = await readPayload(request);
  if (payload instanceof Response) return payload;

  const text = payload.text.trim();
  if (!text) return jsonResponse({ error: "empty text" }, 400);
  if (text.length > MAX_TTS_TEXT_CHARS) {
    return jsonResponse({ error: "text too large" }, 413);
  }
  if (!ALLOWED_VOICES.has(payload.voice)) {
    return jsonResponse({ error: "unsupported voice" }, 400);
  }

  const synthesize = options.synthesize ?? synthesizeEdgeMp3;
  try {
    const audio = await synthesize(text, payload.voice);
    const body = Uint8Array.from(audio);
    return new Response(body, {
      status: 200,
      headers: { "content-type": "audio/mpeg" },
    });
  } catch {
    return jsonResponse({ error: "tts upstream failed" }, 502);
  }
}
