import { ApiError, AuthError, QuotaError } from "./apiErrors";
import {
  CLIENT_STREAM_TIMEOUT_MS,
  parseTranslateTextPayload,
  runTranslateStream,
} from "./apiStream";
import type {
  DecideRequest,
  DecideResponse,
  Rung,
  RungResponse,
  SyncRequest,
  SyncResponse,
  ThreadResponse,
  TranslateRequest,
} from "./types";

export { ApiError, AuthError, QuotaError };

export interface ApiClient {
  fetchRung(rung: Rung, url: string): Promise<RungResponse>;
  fetchThread(url: string): Promise<ThreadResponse>;
  translate(request: TranslateRequest, signal?: AbortSignal): Promise<string>;
  translateStream(
    request: TranslateRequest,
    signal: AbortSignal | undefined,
    onDelta?: (partial: string) => void,
  ): Promise<string>;
  health(): Promise<boolean>;
  decide(request: DecideRequest, signal?: AbortSignal): Promise<DecideResponse>;
  sync(request: SyncRequest): Promise<SyncResponse>;
}

// Client-side cutoff, slightly above the worker's own upstream timeouts (90s
// translate, 20s per fetch hop) so its clean error responses win when it is
// alive. Without this, a dropped connection hangs the fetch forever.
const CLIENT_TIMEOUT_MS = 130_000;

const THREAD_FETCH_FAILED = "Could not fetch the thread right now. Try again.";

function threadErrorMessage(status: number): string {
  if (status === 400) return "That doesn't look like a link to a post.";
  if (status === 404)
    return "That post could not be found — it may have been deleted or protected.";
  return THREAD_FETCH_FAILED;
}

async function ensureOk(response: Response): Promise<Response> {
  if (response.status === 401) throw new AuthError();
  if (response.status === 429) throw new QuotaError();
  if (!response.ok)
    throw new ApiError(`request failed: ${response.status}`, response.status);
  return response;
}

function requestTimeoutSignal(userSignal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(CLIENT_TIMEOUT_MS);
  return userSignal ? AbortSignal.any([timeout, userSignal]) : timeout;
}

export function createApi(options: {
  token: string;
  fetchFn?: typeof fetch;
}): ApiClient {
  const fetchFn = options.fetchFn ?? fetch;
  const authHeaders = { Authorization: `Bearer ${options.token}` };

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

    async fetchThread(url) {
      let response: Response;
      try {
        response = await ensureOk(
          await fetchFn(`/api/thread?url=${encodeURIComponent(url)}`, {
            headers: authHeaders,
            signal: AbortSignal.timeout(CLIENT_TIMEOUT_MS),
          }),
        );
      } catch (error) {
        if (error instanceof AuthError || error instanceof QuotaError)
          throw error;
        if (error instanceof ApiError)
          throw new Error(threadErrorMessage(error.status));
        throw error;
      }
      let data: Partial<ThreadResponse>;
      try {
        data = (await response.json()) as Partial<ThreadResponse>;
      } catch {
        throw new Error(THREAD_FETCH_FAILED);
      }
      if (typeof data.text !== "string" || typeof data.title !== "string")
        throw new Error(THREAD_FETCH_FAILED);
      return {
        title: data.title,
        author: typeof data.author === "string" ? data.author : "",
        text: data.text,
        tweetCount: typeof data.tweetCount === "number" ? data.tweetCount : 0,
        partial: data.partial === true,
        source: data.source === "syndication" ? "syndication" : "fxtwitter",
      };
    },

    async translate(request, signal) {
      const response = await ensureOk(
        await fetchFn("/api/translate", {
          method: "POST",
          headers: { ...authHeaders, "Content-Type": "application/json" },
          body: JSON.stringify(request),
          signal: requestTimeoutSignal(signal),
        }),
      );
      const data = (await response.json()) as { text?: unknown };
      return parseTranslateTextPayload(data);
    },

    async translateStream(request, signal, onDelta) {
      return runTranslateStream(
        async (body, streamSignal) =>
          ensureOk(
            await fetchFn("/api/translate?stream=1", {
              method: "POST",
              headers: { ...authHeaders, "Content-Type": "application/json" },
              body: JSON.stringify(body),
              signal: streamSignal,
            }),
          ),
        request,
        signal,
        onDelta,
      );
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

    async decide(request, signal) {
      const response = await ensureOk(
        await fetchFn("/api/decide", {
          method: "POST",
          headers: { ...authHeaders, "Content-Type": "application/json" },
          body: JSON.stringify(request),
          signal: requestTimeoutSignal(signal),
        }),
      );
      const data = (await response.json()) as { answers?: unknown };
      if (!data.answers || typeof data.answers !== "object") {
        throw new ApiError("malformed decide response", 502);
      }
      return { answers: data.answers as Record<string, unknown> };
    },

    async sync(request) {
      const response = await ensureOk(
        await fetchFn("/api/sync", {
          method: "POST",
          headers: { ...authHeaders, "Content-Type": "application/json" },
          body: JSON.stringify(request),
          signal: AbortSignal.timeout(CLIENT_TIMEOUT_MS),
        }),
      );
      return (await response.json()) as SyncResponse;
    },
  };
}

export { CLIENT_STREAM_TIMEOUT_MS };
