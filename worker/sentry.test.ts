import { describe, expect, it } from "vitest";
import type { Env } from "./env";
import { scrubSentryValue, workerSentryOptions } from "./sentry";

const baseEnv = {
  OPENCODE_API_KEY: "zen",
  APP_TOKEN: "tok",
  BUDGET: {
    get: async () => null,
    put: async () => undefined,
  },
  DB: {
    prepare() {
      throw new Error("unused");
    },
  },
  ASSETS: { fetch: async () => new Response("ok") },
  ALLOWED_MODELS: "x",
  DAILY_CHUNK_BUDGET: "1",
} satisfies Env;

describe("workerSentryOptions", () => {
  it("returns undefined when SENTRY_DSN is missing or blank", () => {
    expect(workerSentryOptions(baseEnv)).toBeUndefined();
    expect(
      workerSentryOptions({ ...baseEnv, SENTRY_DSN: "   " }),
    ).toBeUndefined();
  });

  it("returns a Cloudflare options object when SENTRY_DSN is set", () => {
    const dsn = "https://abc@o1.ingest.sentry.io/1";
    const options = workerSentryOptions({ ...baseEnv, SENTRY_DSN: dsn });
    expect(options).toMatchObject({
      dsn,
      tracesSampleRate: 0,
    });
    expect(options?.beforeSend).toEqual(expect.any(Function));
    const event = { message: "x", tags: { keep: "1" } };
    // beforeSend hint is unused; pass a minimal stub for the SDK signature.
    const result = options?.beforeSend?.(event as never, {} as never);
    expect(result).toMatchObject({
      tags: { keep: "1", side: "worker" },
    });
  });
});

describe("scrubSentryValue", () => {
  it("redacts secret-like keys recursively", () => {
    expect(
      scrubSentryValue({
        ok: true,
        APP_TOKEN: "secret",
        nested: { authorization: "Bearer x", count: 2 },
      }),
    ).toEqual({
      ok: true,
      APP_TOKEN: "[redacted]",
      nested: { authorization: "[redacted]", count: 2 },
    });
  });
});
