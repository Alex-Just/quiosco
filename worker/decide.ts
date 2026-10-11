import { consumeChunks, DEFAULT_DAILY_CHUNK_BUDGET } from "./budget";
import type { Env } from "./env";
import { jsonResponse } from "./headers";

export const DECIDE_TIMEOUT_MS = 30_000;
export const MAX_DECIDE_BODY_BYTES = 512 * 1024;
const MAX_STATE_CHARS = 32_000;
const MAX_QUESTIONS = 8;

export interface DecidePayload {
  model: string;
  state: string;
  questions: Record<string, unknown>;
}

export function decisionModels(env: Env): string[] {
  return (env.DECISION_MODELS ?? "")
    .split(",")
    .map((model) => model.trim())
    .filter((model) => model.length > 0);
}

function parseDailyBudget(env: Env): number {
  const parsed = Number.parseInt(env.DAILY_CHUNK_BUDGET ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_DAILY_CHUNK_BUDGET;
}

function isValidQuestionEntry(
  key: string,
  question: unknown,
): question is Record<string, unknown> & {
  type: string;
  instructions: string;
} {
  if (key.length === 0 || !question || typeof question !== "object")
    return false;
  if (Array.isArray(question)) return false;
  const typed = question as { type?: unknown; instructions?: unknown };
  return (
    typeof typed.type === "string" && typeof typed.instructions === "string"
  );
}

function isQuestionMap(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0 || entries.length > MAX_QUESTIONS) return false;
  return entries.every(([key, question]) =>
    isValidQuestionEntry(key, question),
  );
}

async function readDecidePayload(
  request: Request,
): Promise<DecidePayload | Response> {
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_DECIDE_BODY_BYTES) {
      return jsonResponse({ error: "request too large" }, 413);
    }
    const data = JSON.parse(raw) as Partial<DecidePayload>;
    if (
      typeof data.model !== "string" ||
      typeof data.state !== "string" ||
      !isQuestionMap(data.questions)
    ) {
      return jsonResponse({ error: "invalid request" }, 400);
    }
    return {
      model: data.model,
      state: data.state,
      questions: data.questions,
    };
  } catch {
    return jsonResponse({ error: "invalid request" }, 400);
  }
}

function validateDecidePayload(
  payload: DecidePayload,
  env: Env,
): Response | null {
  if (!decisionModels(env).includes(payload.model)) {
    return jsonResponse({ error: "model not allowed" }, 400);
  }
  if (
    payload.state.trim().length === 0 ||
    payload.state.length > MAX_STATE_CHARS
  ) {
    return jsonResponse({ error: "invalid text" }, 400);
  }
  return null;
}

async function fetchDecideAnswers(
  payload: DecidePayload,
  env: Env,
  fetchImpl: typeof fetch,
): Promise<Response> {
  const upstream = await fetchImpl("https://opencode.ai/zen/v1/systemone", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENCODE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: payload.model,
      state: payload.state,
      questions: payload.questions,
    }),
    signal: AbortSignal.timeout(DECIDE_TIMEOUT_MS),
  });
  if (!upstream.ok) {
    await upstream.body?.cancel().catch(() => undefined);
    return jsonResponse({ error: "upstream error" }, 502);
  }
  const data = (await upstream.json()) as { answers?: unknown };
  if (!data.answers || typeof data.answers !== "object") {
    return jsonResponse({ error: "upstream error" }, 502);
  }
  return jsonResponse({ answers: data.answers });
}

export async function handleDecide(
  request: Request,
  env: Env,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const payloadOrResponse = await readDecidePayload(request);
  if (payloadOrResponse instanceof Response) return payloadOrResponse;
  const invalid = validateDecidePayload(payloadOrResponse, env);
  if (invalid) return invalid;

  const budget = await consumeChunks(env.BUDGET, 1, parseDailyBudget(env));
  if (!budget.ok) return jsonResponse({ error: "daily budget exceeded" }, 429);

  try {
    return await fetchDecideAnswers(payloadOrResponse, env, fetchImpl);
  } catch {
    return jsonResponse({ error: "upstream error" }, 502);
  }
}
