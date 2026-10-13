import { synthesizeEdgeMp3 } from "./edgeTtsClient";
import { synthesizeElevenLabsMp3 } from "./elevenLabsTts";
import type { Env } from "./env";
import { jsonResponse } from "./headers";

export const EDGE_VOICE_ELVIRA = "es-ES-ElviraNeural";
export const EDGE_VOICE_ALVARO = "es-ES-AlvaroNeural";

/** One Zen page / sentence unit; reject whole-book dumps. */
export const MAX_TTS_TEXT_CHARS = 4000;

const ALLOWED_EDGE_VOICES = new Set([EDGE_VOICE_ELVIRA, EDGE_VOICE_ALVARO]);

export type TtsProvider = "edge" | "elevenlabs";

export type TtsSynthesize = (
  text: string,
  provider: TtsProvider,
  voice: string,
) => Promise<Uint8Array>;

export type HandleTtsOptions = {
  synthesize?: TtsSynthesize;
  env?: Pick<Env, "ELEVENLABS_API_KEY">;
};

type TtsPayload = {
  text: string;
  provider: TtsProvider;
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
  const body = data as Partial<TtsPayload> & { provider?: string };
  if (typeof body.text !== "string" || typeof body.voice !== "string") {
    return jsonResponse({ error: "invalid request" }, 400);
  }
  // Backward compatible: omit provider → edge (legacy clients).
  const provider: TtsProvider =
    body.provider === "elevenlabs"
      ? "elevenlabs"
      : body.provider === "edge" || body.provider === undefined
        ? "edge"
        : ("invalid" as TtsProvider);
  if (provider !== "edge" && provider !== "elevenlabs") {
    return jsonResponse({ error: "unsupported provider" }, 400);
  }
  return { text: body.text, provider, voice: body.voice };
}

function defaultSynthesize(
  env: Pick<Env, "ELEVENLABS_API_KEY"> | undefined,
): TtsSynthesize {
  return async (text, provider, voice) => {
    if (provider === "edge") return synthesizeEdgeMp3(text, voice);
    return synthesizeElevenLabsMp3(text, voice, env?.ELEVENLABS_API_KEY ?? "");
  };
}

/** Authenticated TTS proxy: Edge Castilian or ElevenLabs Flash v2.5. */
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
  if (payload.provider === "edge" && !ALLOWED_EDGE_VOICES.has(payload.voice)) {
    return jsonResponse({ error: "unsupported voice" }, 400);
  }
  if (payload.provider === "elevenlabs" && !payload.voice.trim()) {
    return jsonResponse({ error: "empty voice id" }, 400);
  }

  const synthesize = options.synthesize ?? defaultSynthesize(options.env);
  try {
    const audio = await synthesize(text, payload.provider, payload.voice);
    const body = Uint8Array.from(audio);
    return new Response(body, {
      status: 200,
      headers: { "content-type": "audio/mpeg" },
    });
  } catch {
    return jsonResponse({ error: "tts upstream failed" }, 502);
  }
}
