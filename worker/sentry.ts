import type { CloudflareOptions } from "@sentry/cloudflare";
import type { Env } from "./env";

const WORKER_SIDE_TAG = "worker";
const TRACES_SAMPLE_RATE_OFF = 0;

/** Redact secret-like keys before they leave the Worker for Sentry. */
export function scrubSentryValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(scrubSentryValue);
  if (typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (/token|password|authorization|api[_-]?key/i.test(key)) {
      out[key] = "[redacted]";
    } else {
      out[key] = scrubSentryValue(entry);
    }
  }
  return out;
}

/**
 * Options for `@sentry/cloudflare` `withSentry`. Returns `undefined` when
 * `SENTRY_DSN` is unset so local/dev Workers without a secret stay quiet.
 */
export function workerSentryOptions(env: Env): CloudflareOptions | undefined {
  const dsn = typeof env.SENTRY_DSN === "string" ? env.SENTRY_DSN.trim() : "";
  if (!dsn) return undefined;

  return {
    dsn,
    tracesSampleRate: TRACES_SAMPLE_RATE_OFF,
    beforeSend(event) {
      event.tags = { ...event.tags, side: WORKER_SIDE_TAG };
      if (event.extra)
        event.extra = scrubSentryValue(event.extra) as typeof event.extra;
      if (event.contexts) {
        event.contexts = scrubSentryValue(
          event.contexts,
        ) as typeof event.contexts;
      }
      return event;
    },
    beforeBreadcrumb(breadcrumb) {
      if (breadcrumb.data) {
        breadcrumb.data = scrubSentryValue(breadcrumb.data) as Record<
          string,
          unknown
        >;
      }
      return breadcrumb;
    },
  };
}
