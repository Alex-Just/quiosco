import type { Rung, RungResponse, TranslateRequest } from "./types";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export class AuthError extends ApiError {
  constructor(message = "unauthorized") {
    super(message, 401);
    this.name = "AuthError";
  }
}

export class QuotaError extends ApiError {
  constructor(message = "daily budget exceeded") {
    super(message, 429);
    this.name = "QuotaError";
  }
}

export interface ApiClient {
  fetchRung(rung: Rung, url: string): Promise<RungResponse>;
  translate(request: TranslateRequest, signal?: AbortSignal): Promise<string>;
  translateStream(
    request: TranslateRequest,
    signal: AbortSignal | undefined,
    onDelta?: (partial: string) => void,
  ): Promise<string>;
  health(): Promise<boolean>;
}

// Client-side cutoff, slightly above the worker's own upstream timeouts (90s
// translate, 20s per fetch hop) so its clean error responses win when it is
// alive. Without this, a dropped connection hangs the fetch forever.
const CLIENT_TIMEOUT_MS = 130_000;
// Streaming: a hard cap for the whole stream plus an idle watchdog that fires
// when no bytes arrive for a minute.
const CLIENT_STREAM_TIMEOUT_MS = 300_000;
const STREAM_IDLE_TIMEOUT_MS = 60_000;

export function createApi(options: {
  token: string;
  fetchFn?: typeof fetch;
}): ApiClient {
  const fetchFn = options.fetchFn ?? fetch;
  const authHeaders = { Authorization: `Bearer ${options.token}` };

  async function ensureOk(response: Response): Promise<Response> {
    if (response.status === 401) throw new AuthError();
    if (response.status === 429) throw new QuotaError();
    if (!response.ok)
      throw new ApiError(`request failed: ${response.status}`, response.status);
    return response;
  }

  return {
    async fetchRung(rung, url) {
      const response = await ensureOk(
        await fetchFn(
          `/api/fetch?mode=${rung}&url=${encodeURIComponent(url)}`,
          {
            headers: authHeaders,
            signal: AbortSignal.timeout(CLIENT_TIMEOUT_MS),
          },
        ),
      );
      return {
        bytes: new Uint8Array(await response.arrayBuffer()),
        contentType: response.headers.get("content-type"),
        kind:
          response.headers.get("x-quiosco-kind") === "markdown"
            ? "markdown"
            : "html",
        via: rung,
        finalUrl: response.headers.get("x-quiosco-final-url"),
      };
    },

    async translate(request, signal) {
      const timeout = AbortSignal.timeout(CLIENT_TIMEOUT_MS);
      const response = await ensureOk(
        await fetchFn("/api/translate", {
          method: "POST",
          headers: { ...authHeaders, "Content-Type": "application/json" },
          body: JSON.stringify(request),
          signal: signal ? AbortSignal.any([timeout, signal]) : timeout,
        }),
      );
      const data = (await response.json()) as { text?: unknown };
      if (typeof data.text !== "string")
        throw new ApiError("malformed translate response", 502);
      return data.text;
    },

    async translateStream(request, signal, onDelta) {
      const idle = new AbortController();
      let idleTimer = setTimeout(() => idle.abort(), STREAM_IDLE_TIMEOUT_MS);
      const resetIdle = () => {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => idle.abort(), STREAM_IDLE_TIMEOUT_MS);
      };
      const cap = AbortSignal.timeout(CLIENT_STREAM_TIMEOUT_MS);
      const combined = signal
        ? AbortSignal.any([signal, idle.signal, cap])
        : AbortSignal.any([idle.signal, cap]);
      try {
        const response = await ensureOk(
          await fetchFn("/api/translate?stream=1", {
            method: "POST",
            headers: { ...authHeaders, "Content-Type": "application/json" },
            body: JSON.stringify(request),
            signal: combined,
          }),
        );
        const contentType = response.headers.get("content-type") ?? "";
        if (!contentType.includes("text/event-stream")) {
          // Non-streaming fallback (e.g., responses-protocol models).
          const data = (await response.json()) as { text?: unknown };
          if (typeof data.text !== "string")
            throw new ApiError("malformed translate response", 502);
          return data.text;
        }
        const reader = response.body?.getReader();
        if (!reader) throw new ApiError("missing stream body", 502);
        const decoder = new TextDecoder();
        let buffer = "";
        let text = "";
        let completed = false;
        const processEvent = (event: string) => {
          for (const line of event.split("\n")) {
            if (!line.startsWith("data:")) continue;
            const data = line.slice(5).trim();
            if (data === "[DONE]") {
              completed = true;
              continue;
            }
            try {
              const parsed = JSON.parse(data) as {
                choices?: Array<{ delta?: { content?: unknown } }>;
              };
              const delta = parsed.choices?.[0]?.delta?.content;
              if (typeof delta === "string" && delta.length > 0) {
                text += delta;
                onDelta?.(text);
              }
            } catch {
              // Ignore non-JSON keep-alive payloads.
            }
          }
        };
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          resetIdle();
          buffer += decoder
            .decode(value, { stream: true })
            .replace(/\r\n/g, "\n");
          let boundary = buffer.indexOf("\n\n");
          while (boundary >= 0) {
            processEvent(buffer.slice(0, boundary));
            buffer = buffer.slice(boundary + 2);
            boundary = buffer.indexOf("\n\n");
          }
        }
        // Process a trailing event even when the final blank line is missing.
        if (buffer.trim().length > 0) processEvent(buffer);
        if (!completed) throw new ApiError("stream interrupted", 502);
        return text;
      } finally {
        clearTimeout(idleTimer);
      }
    },

    async health() {
      await ensureOk(
        await fetchFn("/api/health", {
          headers: authHeaders,
          signal: AbortSignal.timeout(CLIENT_TIMEOUT_MS),
        }),
      );
      return true;
    },
  };
}
