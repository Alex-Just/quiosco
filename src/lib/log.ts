import { type DBSchema, type IDBPDatabase, openDB } from "idb";

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogEvent = {
  id?: number;
  ts: number;
  level: LogLevel;
  category: string;
  message: string;
  data?: Record<string, unknown>;
};

export type LogSink = {
  onBreadcrumb: (event: LogEvent) => void;
  onError: (event: LogEvent, error?: Error) => void;
};

export const LOG_MAX_EVENTS = 500;
export const LOG_MAX_BYTES = 100_000;
const LOG_MESSAGE_MAX = 300;
const SENSITIVE_KEY = /token|password|authorization|api[_-]?key/i;

interface LogsDB extends DBSchema {
  events: {
    key: number;
    value: LogEvent;
  };
}

export type LogControllerOptions = {
  dbName?: string;
  maxEvents?: number;
  maxBytes?: number;
  sink?: LogSink | null;
  now?: () => number;
  isDev?: boolean;
};

export type LogController = {
  debug: (
    category: string,
    message: string,
    data?: Record<string, unknown>,
  ) => void;
  info: (
    category: string,
    message: string,
    data?: Record<string, unknown>,
  ) => void;
  warn: (
    category: string,
    message: string,
    data?: Record<string, unknown>,
  ) => void;
  error: (
    category: string,
    message: string,
    data?: Record<string, unknown>,
    error?: Error,
  ) => void;
  exportLogText: () => Promise<string>;
  clearLogs: () => Promise<void>;
  getLogStatus: () => Promise<{ count: number; oldestTs: number | null }>;
  flush: () => Promise<void>;
  setSink: (sink: LogSink | null) => void;
  close: () => Promise<void>;
};

function truncateMessage(message: string): string {
  if (message.length <= LOG_MESSAGE_MAX) return message;
  return `${message.slice(0, LOG_MESSAGE_MAX)}…`;
}

/** Redact sensitive keys recursively for safe persistence and Sentry. */
export function scrubLogData(
  data: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!data) return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (SENSITIVE_KEY.test(key)) {
      out[key] = "[redacted]";
      continue;
    }
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      out[key] = scrubLogData(value as Record<string, unknown>);
      continue;
    }
    out[key] = value;
  }
  return out;
}

export function formatLogExport(events: readonly LogEvent[]): string {
  return events
    .map((event) => {
      const when = new Date(event.ts).toISOString();
      const data =
        event.data && Object.keys(event.data).length > 0
          ? ` ${JSON.stringify(event.data)}`
          : "";
      return `${when} ${event.level} ${event.category} ${event.message}${data}`;
    })
    .join("\n");
}

function eventBytes(event: LogEvent): number {
  return new TextEncoder().encode(formatLogExport([event])).length;
}

function shouldSendBreadcrumb(event: LogEvent): boolean {
  if (event.level === "debug") return false;
  if (event.level === "warn" || event.level === "error") return true;
  return event.category === "tts" || event.category === "settings";
}

function mirrorConsole(event: LogEvent, isDev: boolean): void {
  if (!isDev && (event.level === "debug" || event.level === "info")) return;
  const line = `[${event.category}] ${event.message}`;
  const args = event.data ? [line, event.data] : [line];
  if (event.level === "error") console.error(...args);
  else if (event.level === "warn") console.warn(...args);
  else if (event.level === "info") console.info(...args);
  else console.debug(...args);
}

export function createLogController(
  options: LogControllerOptions = {},
): LogController {
  const dbName = options.dbName ?? "quiosco-logs";
  const maxEvents = options.maxEvents ?? LOG_MAX_EVENTS;
  const maxBytes = options.maxBytes ?? LOG_MAX_BYTES;
  const now = options.now ?? Date.now;
  const isDev =
    options.isDev ??
    (typeof import.meta !== "undefined" &&
      Boolean(import.meta.env?.DEV));
  let sink = options.sink ?? null;
  let memory: LogEvent[] = [];
  let dbPromise: Promise<IDBPDatabase<LogsDB>> | null = null;
  let writeChain: Promise<void> = Promise.resolve();

  function getDb(): Promise<IDBPDatabase<LogsDB>> {
    if (!dbPromise) {
      dbPromise = openDB<LogsDB>(dbName, 1, {
        upgrade(database) {
          database.createObjectStore("events", {
            keyPath: "id",
            autoIncrement: true,
          });
        },
      });
    }
    return dbPromise;
  }

  function trim(events: LogEvent[]): LogEvent[] {
    let next = [...events];
    while (next.length > maxEvents) next.shift();
    let size = next.reduce((sum, event) => sum + eventBytes(event), 0);
    while (next.length > 0 && size > maxBytes) {
      const removed = next.shift();
      if (removed) size -= eventBytes(removed);
    }
    return next;
  }

  function enqueue(event: LogEvent, error?: Error): void {
    memory = trim([...memory, event]);
    mirrorConsole(event, isDev);
    if (sink) {
      if (event.level === "error") sink.onError(event, error);
      else if (shouldSendBreadcrumb(event)) sink.onBreadcrumb(event);
    }
    writeChain = writeChain
      .then(async () => {
        const db = await getDb();
        await db.add("events", event);
        const all = await db.getAll("events");
        const kept = trim(all);
        if (kept.length === all.length) return;
        const keepIds = new Set(
          kept.map((entry) => entry.id).filter((id): id is number => id != null),
        );
        const tx = db.transaction("events", "readwrite");
        for (const entry of all) {
          if (entry.id != null && !keepIds.has(entry.id)) {
            await tx.store.delete(entry.id);
          }
        }
        await tx.done;
        memory = kept.map(({ id: _id, ...rest }) => rest);
      })
      .catch(() => {
        // Best-effort persistence; Listen must not fail on log I/O.
      });
  }

  function write(
    level: LogLevel,
    category: string,
    message: string,
    data?: Record<string, unknown>,
    error?: Error,
  ): void {
    enqueue(
      {
        ts: now(),
        level,
        category,
        message: truncateMessage(message),
        data: scrubLogData(data),
      },
      error,
    );
  }

  return {
    debug: (category, message, data) => write("debug", category, message, data),
    info: (category, message, data) => write("info", category, message, data),
    warn: (category, message, data) => write("warn", category, message, data),
    error: (category, message, data, error) =>
      write("error", category, message, data, error),
    async exportLogText() {
      await writeChain;
      try {
        const db = await getDb();
        const all = trim(await db.getAll("events"));
        return formatLogExport(all);
      } catch {
        return formatLogExport(memory);
      }
    },
    async clearLogs() {
      await writeChain;
      memory = [];
      try {
        const db = await getDb();
        await db.clear("events");
      } catch {
        // ignore
      }
    },
    async getLogStatus() {
      await writeChain;
      try {
        const db = await getDb();
        const all = trim(await db.getAll("events"));
        return {
          count: all.length,
          oldestTs: all[0]?.ts ?? null,
        };
      } catch {
        return {
          count: memory.length,
          oldestTs: memory[0]?.ts ?? null,
        };
      }
    },
    flush: () => writeChain,
    setSink(next) {
      sink = next;
    },
    async close() {
      await writeChain;
      if (dbPromise) {
        const db = await dbPromise;
        db.close();
        dbPromise = null;
      }
    },
  };
}

export const log = createLogController();

export async function exportLogText(): Promise<string> {
  return log.exportLogText();
}

export async function clearLogs(): Promise<void> {
  return log.clearLogs();
}

export async function getLogStatus(): Promise<{
  count: number;
  oldestTs: number | null;
}> {
  return log.getLogStatus();
}
