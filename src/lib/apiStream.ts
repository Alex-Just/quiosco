import { ApiError } from "./apiErrors";
import type { TranslateRequest } from "./types";

export const CLIENT_STREAM_TIMEOUT_MS = 300_000;
export const STREAM_IDLE_TIMEOUT_MS = 60_000;

export function parseTranslateTextPayload(data: { text?: unknown }): string {
  if (typeof data.text !== "string")
    throw new ApiError("malformed translate response", 502);
  return data.text;
}

export function applySseEvent(
  event: string,
  state: { text: string; completed: boolean },
  onDelta?: (partial: string) => void,
): void {
  for (const line of event.split("\n")) {
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (data === "[DONE]") {
      state.completed = true;
      continue;
    }
    try {
      const parsed = JSON.parse(data) as {
        choices?: Array<{ delta?: { content?: unknown } }>;
      };
      const delta = parsed.choices?.[0]?.delta?.content;
      if (typeof delta === "string" && delta.length > 0) {
        state.text += delta;
        onDelta?.(state.text);
      }
    } catch {
      // Ignore non-JSON keep-alive payloads.
    }
  }
}

async function readSseBody(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onDelta: ((partial: string) => void) | undefined,
  resetIdle: () => void,
): Promise<{ text: string; completed: boolean }> {
  const decoder = new TextDecoder();
  let buffer = "";
  const state = { text: "", completed: false };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    resetIdle();
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      applySseEvent(buffer.slice(0, boundary), state, onDelta);
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf("\n\n");
    }
  }
  // Process a trailing event even when the final blank line is missing.
  if (buffer.trim().length > 0) applySseEvent(buffer, state, onDelta);
  return state;
}

function combinedStreamSignal(
  signal: AbortSignal | undefined,
  idle: AbortSignal,
): AbortSignal {
  const cap = AbortSignal.timeout(CLIENT_STREAM_TIMEOUT_MS);
  return signal
    ? AbortSignal.any([signal, idle, cap])
    : AbortSignal.any([idle, cap]);
}

async function bodyFromStreamResponse(
  response: Response,
  resetIdle: () => void,
  onDelta?: (partial: string) => void,
): Promise<string> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/event-stream")) {
    const data = (await response.json()) as { text?: unknown };
    return parseTranslateTextPayload(data);
  }
  const reader = response.body?.getReader();
  if (!reader) throw new ApiError("missing stream body", 502);
  const { text, completed } = await readSseBody(reader, onDelta, resetIdle);
  if (!completed) throw new ApiError("stream interrupted", 502);
  return text;
}

export async function runTranslateStream(
  fetchStream: (
    request: TranslateRequest,
    signal: AbortSignal,
  ) => Promise<Response>,
  request: TranslateRequest,
  signal: AbortSignal | undefined,
  onDelta?: (partial: string) => void,
): Promise<string> {
  const idle = new AbortController();
  let idleTimer = setTimeout(() => idle.abort(), STREAM_IDLE_TIMEOUT_MS);
  const resetIdle = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => idle.abort(), STREAM_IDLE_TIMEOUT_MS);
  };
  const combined = combinedStreamSignal(signal, idle.signal);
  try {
    const response = await fetchStream(request, combined);
    return await bodyFromStreamResponse(response, resetIdle, onDelta);
  } finally {
    clearTimeout(idleTimer);
  }
}
