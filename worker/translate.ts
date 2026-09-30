import { consumeChunks, DEFAULT_DAILY_CHUNK_BUDGET } from "./budget";
import type { Env } from "./env";
import { jsonResponse } from "./headers";

export const TRANSLATE_TIMEOUT_MS = 120_000;
export const MAX_TRANSLATE_BODY_BYTES = 2 * 1024 * 1024;
const MAX_CHUNK_TEXT_CHARS = 100_000;

export interface TranslatePayload {
  model: string;
  system: string;
  text: string;
}

export function allowedModels(env: Env): string[] {
  return (env.ALLOWED_MODELS ?? "")
    .split(",")
    .map((model) => model.trim())
    .filter((model) => model.length > 0);
}

export function parseDailyBudget(env: Env): number {
  const parsed = Number.parseInt(env.DAILY_CHUNK_BUDGET ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_DAILY_CHUNK_BUDGET;
}

export async function handleTranslate(
  request: Request,
  env: Env,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  let payload: TranslatePayload;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_TRANSLATE_BODY_BYTES) {
      return jsonResponse({ error: "request too large" }, 413);
    }
    const data = JSON.parse(raw) as Partial<TranslatePayload>;
    if (
      typeof data.model !== "string" ||
      typeof data.system !== "string" ||
      typeof data.text !== "string"
    ) {
      return jsonResponse({ error: "invalid request" }, 400);
    }
    payload = { model: data.model, system: data.system, text: data.text };
  } catch {
    return jsonResponse({ error: "invalid request" }, 400);
  }

  if (!allowedModels(env).includes(payload.model)) {
    return jsonResponse({ error: "model not allowed" }, 400);
  }
  if (
    payload.system.length === 0 ||
    payload.text.trim().length === 0 ||
    payload.text.length > MAX_CHUNK_TEXT_CHARS
  ) {
    return jsonResponse({ error: "invalid text" }, 400);
  }

  const budget = await consumeChunks(env.BUDGET, 1, parseDailyBudget(env));
  if (!budget.ok) return jsonResponse({ error: "daily budget exceeded" }, 429);

  try {
    const upstream = await fetchImpl(
      "https://opencode.ai/zen/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.OPENCODE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: payload.model,
          messages: [
            { role: "system", content: payload.system },
            { role: "user", content: payload.text },
          ],
        }),
        signal: AbortSignal.timeout(TRANSLATE_TIMEOUT_MS),
      },
    );
    if (!upstream.ok) {
      await upstream.body?.cancel().catch(() => undefined);
      return jsonResponse({ error: "upstream error" }, 502);
    }
    const data = (await upstream.json()) as {
      choices?: Array<{ message?: { content?: unknown } }>;
    };
    const text = data.choices?.[0]?.message?.content;
    if (typeof text !== "string")
      return jsonResponse({ error: "upstream error" }, 502);
    return jsonResponse({ text });
  } catch {
    return jsonResponse({ error: "upstream error" }, 502);
  }
}
