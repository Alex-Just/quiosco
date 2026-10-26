import { synthesizeEdgeMp3 } from "./edgeTtsClient";
import { synthesizeElevenLabsMp3 } from "./elevenLabsTts";
import type { Env } from "./env";
import { jsonResponse } from "./headers";

export const EDGE_VOICE_ELVIRA = "es-ES-ElviraNeural";
export const EDGE_VOICE_ALVARO = "es-ES-AlvaroNeural";

/** One Zen page / sentence unit; reject whole-book dumps. */
export const MAX_TTS_TEXT_CHARS = 4000;

/** Clamp for the client's speech rate multiplier (1 = normal). */
export const TTS_RATE_MIN = 0.5;
export const TTS_RATE_MAX = 2;
const DEFAULT_TTS_RATE = 1;

const ALLOWED_EDGE_VOICES = new Set([EDGE_VOICE_ELVIRA, EDGE_VOICE_ALVARO]);

export type TtsProvider = "edge" | "elevenlabs";

export type TtsSynthesize = (
  text: string,
  provider: TtsProvider,
  voice: string,
  rate: number,
) => Promise<Uint8Array>;

export type HandleTtsOptions = {
  synthesize?: TtsSynthesize;
  env?: Pick<Env, "ELEVENLABS_API_KEY">;
};

type TtsPayload = {
  text: string;
  provider: TtsProvider;
  voice: string;
  rate: number;
};

/** Omitted rate means legacy client → normal. Non-numeric rates are invalid. */
function parseRate(value: unknown): number | null {
  if (value === undefined) return DEFAULT_TTS_RATE;
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.min(TTS_RATE_MAX, Math.max(TTS_RATE_MIN, value));
}

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
  const rate = parseRate(body.rate);
  if (rate === null) {
    return jsonResponse({ error: "invalid rate" }, 400);
  }
  return { text: body.text, provider, voice: body.voice, rate };
}

function defaultSynthesize(
  env: Pick<Env, "ELEVENLABS_API_KEY"> | undefined,
): TtsSynthesize {
  return async (text, provider, voice, rate) => {
    if (provider === "edge") return synthesizeEdgeMp3(text, voice, rate);
    return synthesizeElevenLabsMp3(
      text,
      voice,
      env?.ELEVENLABS_API_KEY ?? "",
      rate,
    );
  };
}

/** Authenticated TTS proxy: Edge Castilian or ElevenLabs Turbo v2.5. */
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
    const audio = await synthesize(
      text,
      payload.provider,
      payload.voice,
      payload.rate,
    );
    const body = Uint8Array.from(audio);
    return new Response(body, {
      status: 200,
      headers: { "content-type": "audio/mpeg" },
    });
  } catch (error) {
    console.error(
      "tts upstream failed",
      error instanceof Error ? error.message : error,
    );
    return jsonResponse({ error: "tts upstream failed" }, 502);
  }
}
