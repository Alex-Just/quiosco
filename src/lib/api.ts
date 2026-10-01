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
  translate(request: TranslateRequest): Promise<string>;
  health(): Promise<boolean>;
}

// Client-side cutoff, slightly above the worker's own upstream timeouts (90s
// translate, 20s per fetch hop) so its clean error responses win when it is
// alive. Without this, a dropped connection hangs the fetch forever.
const CLIENT_TIMEOUT_MS = 130_000;

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

    async translate(request) {
      const response = await ensureOk(
        await fetchFn("/api/translate", {
          method: "POST",
          headers: { ...authHeaders, "Content-Type": "application/json" },
          body: JSON.stringify(request),
          signal: AbortSignal.timeout(CLIENT_TIMEOUT_MS),
        }),
      );
      const data = (await response.json()) as { text?: unknown };
      if (typeof data.text !== "string")
        throw new ApiError("malformed translate response", 502);
      return data.text;
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
