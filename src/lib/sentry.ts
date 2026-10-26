import * as Sentry from "@sentry/react";
import type { LogEvent, LogSink } from "./log";
import { log } from "./log";

function readBrowserDsn(): string {
  const value = import.meta.env.VITE_SENTRY_DSN;
  return typeof value === "string" ? value.trim() : "";
}

function scrubSentryValue(value: unknown): unknown {
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

/** Browser Sentry sink used by the shared log controller. */
export function createSentryLogSink(): LogSink {
  return {
    onBreadcrumb(event: LogEvent) {
      Sentry.addBreadcrumb({
        category: event.category,
        message: event.message,
        level: event.level === "warn" ? "warning" : event.level,
        data: event.data,
        timestamp: event.ts / 1000,
      });
    },
    onError(event: LogEvent, error?: Error) {
      Sentry.withScope((scope) => {
        scope.setTag("side", "client");
        scope.setTag("log.category", event.category);
        if (event.data) scope.setContext("log.data", event.data);
        if (error) Sentry.captureException(error);
        else Sentry.captureMessage(event.message, "error");
      });
    },
  };
}

/**
 * Init browser Sentry when `VITE_SENTRY_DSN` is set. No-op otherwise so the
 * app runs without an account. Wires the shared log sink.
 */
export function initClientSentry(): void {
  const dsn = readBrowserDsn();
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    tracesSampleRate: 0,
    beforeSend(event) {
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
  });
  Sentry.setTag("side", "client");
  log.setSink(createSentryLogSink());
}
