import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthError, QuotaError } from "./apiErrors";
import {
  type BookFinishProgress,
  type BookFinishSession,
  startBookFinish,
} from "./bookFinish";
import type { BookSentenceUnit } from "./bookText";
import type { BookTranslationDeps } from "./bookTranslation";
import type { BookWindowLimits } from "./bookWindow";
import type { SentenceCacheEntry } from "./types";

function u(text: string): BookSentenceUnit {
  return { paragraphIndex: 0, text, skipped: false };
}

function unitsOf(...texts: string[]): BookSentenceUnit[] {
  return texts.map(u);
}

/** Same text ⇒ same key, like the real content-addressed key memo. */
function keyForText(units: readonly BookSentenceUnit[]) {
  return async (unitIndex: number): Promise<string> =>
    `k:${units[unitIndex]?.text ?? ""}`;
}

function cacheEntry(
  overrides: Partial<SentenceCacheEntry> & { key: string },
): SentenceCacheEntry {
  return {
    source: "",
    translation: "",
    targetLanguage: "English",
    rulesHash: "r1",
    model: "m",
    createdAt: 1,
    ...overrides,
  };
}

/** The numbered sentences inside a request's <translate> block. */
function translateSentences(text: string): string[] {
  const match = /<translate>\n([\s\S]*?)\n<\/translate>/.exec(text);
  const block = match?.[1] ?? "";
  return block
    .split("\n")
    .map((line) => line.replace(/^\d+\.\s*/, ""))
    .filter(Boolean);
}

/** Answers every request with the full numbered prefix, and writes the cache. */
function memoryDeps() {
  const map = new Map<string, SentenceCacheEntry>();
  const requests: string[][] = [];
  const deps: BookTranslationDeps = {
    store: {
      getSentences: async (keys) =>
        keys.flatMap((key) => {
          const entry = map.get(key);
          return entry === undefined ? [] : [entry];
        }),
      putSentences: async (entries) => {
        for (const entry of entries) map.set(entry.key, entry);
      },
    },
    translate: async (request) => {
      const sentences = translateSentences(request.text);
      requests.push(sentences);
      return sentences
        .map((sentence, index) => `${index + 1}. T:${sentence}`)
        .join("\n");
    },
  };
  return { deps, map, requests };
}

function failingDeps(error: unknown) {
  const requests: Array<{ model: string; system: string; text: string }> = [];
  const deps: BookTranslationDeps = {
    store: {
      getSentences: async () => [],
      putSentences: async () => {},
    },
    translate: async (request) => {
      requests.push(request);
      throw error;
    },
  };
  return { deps, requests };
}

function emptyReplyDeps() {
  const { deps, requests } = failingDeps(new Error("unused"));
  deps.translate = async (request) => {
    requests.push(request);
    return "";
  };
  return { deps, requests };
}

interface PendingTranslation {
  request: { model: string; system: string; text: string };
  signal?: AbortSignal;
  resolve: (value: string) => void;
  reject: (error: unknown) => void;
}

/** Controllable deps: every request stays pending until the test settles it. */
function deferredDeps() {
  const pending: PendingTranslation[] = [];
  const map = new Map<string, SentenceCacheEntry>();
  const deps: BookTranslationDeps = {
    store: {
      getSentences: async (keys) =>
        keys.flatMap((key) => {
          const entry = map.get(key);
          return entry === undefined ? [] : [entry];
        }),
      putSentences: async (entries) => {
        for (const entry of entries) map.set(entry.key, entry);
      },
    },
    translate: (request, signal) =>
      new Promise<string>((resolve, reject) => {
        pending.push({ request, resolve, reject, signal });
        signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      }),
  };
  return { deps, map, pending };
}

function pendingAt(
  pending: PendingTranslation[],
  index: number,
): PendingTranslation {
  const entry = pending[index];
  if (entry === undefined) throw new Error(`no pending request at ${index}`);
  return entry;
}

const sessionLimits: BookWindowLimits = {
  maxChars: 20,
  maxSentences: 10,
  contextChars: 5,
  runwayChars: 10,
};
/** Windows of four 2-char sentences: finishing a six-sentence book takes two. */
const narrowLimits: BookWindowLimits = { ...sessionLimits, maxChars: 8 };

const sessions: BookFinishSession[] = [];

function startSession(args: {
  deps: BookTranslationDeps;
  units: readonly BookSentenceUnit[];
  limits?: BookWindowLimits;
  scanBatchUnits?: number;
  keyFor?: (unitIndex: number) => Promise<string>;
}): BookFinishSession {
  const session = startBookFinish({
    ...args,
    keyFor: args.keyFor ?? keyForText(args.units),
    model: "m",
    system: "s",
    targetLanguage: "English",
    rulesHashValue: "r1",
  });
  sessions.push(session);
  return session;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

afterEach(() => {
  for (const session of sessions.splice(0)) session.dispose();
  vi.restoreAllMocks();
});

describe("startBookFinish", () => {
  it("translates a small book to completion, exactly once per sentence", async () => {
    const { deps, requests } = memoryDeps();
    const units = unitsOf("s0", "s1", "s2", "s3", "s4", "s5");
    const session = startSession({ deps, units, limits: sessionLimits });

    await vi.waitFor(() => expect(session.status()).toBe("done"));

    expect(session.progress()).toEqual({ done: 6, total: 6 });
    expect(requests.flat()).toEqual(["s0", "s1", "s2", "s3", "s4", "s5"]);
    await sleep(20);
    expect(requests).toHaveLength(1);
  });

  it("resumes from a cached prefix and never re-plans it", async () => {
    const { deps, map, requests } = memoryDeps();
    map.set(
      "k:s0",
      cacheEntry({ key: "k:s0", source: "s0", translation: "T:s0" }),
    );
    map.set(
      "k:s1",
      cacheEntry({ key: "k:s1", source: "s1", translation: "T:s1" }),
    );
    const units = unitsOf("s0", "s1", "s2", "s3", "s4", "s5");
    const session = startSession({ deps, units, limits: sessionLimits });

    await vi.waitFor(() => expect(session.status()).toBe("done"));

    expect(requests[0]).toEqual(["s2", "s3", "s4", "s5"]);
    expect(session.progress()).toEqual({ done: 6, total: 6 });
  });

  it("scans in batches without re-requesting translated windows", async () => {
    const { deps, map, requests } = memoryDeps();
    for (const text of ["s0", "s1", "s2"]) {
      map.set(
        `k:${text}`,
        cacheEntry({
          key: `k:${text}`,
          source: text,
          translation: `T:${text}`,
        }),
      );
    }
    const units = unitsOf("s0", "s1", "s2", "s3", "s4", "s5");
    const session = startSession({
      deps,
      units,
      limits: sessionLimits,
      scanBatchUnits: 2,
    });

    await vi.waitFor(() => expect(requests.length).toBeGreaterThan(0));
    expect(requests[0]).toEqual(["s3", "s4", "s5"]);
    await vi.waitFor(() => expect(session.status()).toBe("done"));
  });

  it("reports monotonic progress and ends at the total", async () => {
    const { deps } = memoryDeps();
    const units = unitsOf("s0", "s1", "s2", "s3", "s4", "s5");
    const session = startSession({ deps, units, limits: narrowLimits });
    const seen: BookFinishProgress[] = [];
    session.onUpdate(() => {
      seen.push(session.progress());
    });

    await vi.waitFor(() => expect(session.status()).toBe("done"));

    expect(seen.length).toBeGreaterThanOrEqual(2);
    let previousDone = -1;
    for (const progress of seen) {
      expect(progress.done).toBeGreaterThanOrEqual(previousDone);
      expect(progress.total).toBe(6);
      previousDone = progress.done;
    }
    expect(seen[seen.length - 1]).toEqual({ done: 6, total: 6 });
  });

  for (const [label, error] of [
    ["quota", new QuotaError()],
    ["auth", new AuthError()],
  ] as const) {
    it(`stops with ${label} and a fresh session still finishes`, async () => {
      const { deps, requests } = failingDeps(error);
      const units = unitsOf("s0", "s1", "s2");
      const session = startSession({ deps, units, limits: sessionLimits });

      await vi.waitFor(() => expect(session.status()).toBe(label));
      expect(requests).toHaveLength(1);
      await sleep(20);
      expect(requests).toHaveLength(1);

      const retry = startSession({
        deps: memoryDeps().deps,
        units,
        limits: sessionLimits,
      });
      await vi.waitFor(() => expect(retry.status()).toBe("done"));
      expect(retry.progress()).toEqual({ done: 3, total: 3 });
    });
  }

  it("pauses when a window accepts nothing", async () => {
    const { deps, requests } = emptyReplyDeps();
    const units = unitsOf("s0", "s1");
    const session = startSession({ deps, units, limits: sessionLimits });

    await vi.waitFor(() => expect(session.status()).toBe("paused"));

    expect(requests).toHaveLength(1);
    await sleep(20);
    expect(requests).toHaveLength(1);
    expect(session.progress()).toEqual({ done: 0, total: 2 });
  });

  it("cancel aborts the in-flight request and stops the loop", async () => {
    const { deps, pending } = deferredDeps();
    const units = unitsOf("s0", "s1", "s2");
    const session = startSession({ deps, units, limits: sessionLimits });
    let updates = 0;
    session.onUpdate(() => {
      updates += 1;
    });

    await vi.waitFor(() => expect(pending).toHaveLength(1));
    expect(updates).toBeGreaterThan(0);

    session.dispose();
    expect(pendingAt(pending, 0).signal?.aborted).toBe(true);
    const seen = updates;
    pendingAt(pending, 0).resolve("1. T:s0\n2. T:s1\n3. T:s2");
    await sleep(20);
    expect(updates).toBe(seen);
    expect(pending).toHaveLength(1);
    expect(session.status()).toBe("working");
  });

  it("shares one cache entry across duplicate sentences and still reaches done", async () => {
    const { deps, requests } = memoryDeps();
    const units = unitsOf("A", "A");
    const session = startSession({ deps, units, limits: sessionLimits });

    await vi.waitFor(() => expect(session.status()).toBe("done"));

    expect(requests).toHaveLength(1);
    expect(requests[0]).toEqual(["A", "A"]);
    expect(session.progress()).toEqual({ done: 2, total: 2 });
  });

  it("finishes a book whose duplicates differ only in layout whitespace", async () => {
    const { deps, requests } = memoryDeps();
    const units = unitsOf("Hello  world.", "Hello world.");
    const session = startSession({
      deps,
      units,
      limits: sessionLimits,
      keyFor: async (unitIndex) =>
        `k:${(units[unitIndex]?.text ?? "").replace(/\s+/g, " ").trim()}`,
    });

    await vi.waitFor(() => expect(session.status()).toBe("done"));

    expect(requests).toHaveLength(1);
    expect(session.progress()).toEqual({ done: 2, total: 2 });
  });

  it("pauses when an accepted window cannot advance the frontier", async () => {
    const { deps, requests } = memoryDeps();
    // The reply is accepted, but the cache write never lands: without a guard
    // the run would re-request the same window forever.
    deps.store.putSentences = async () => undefined;
    deps.store.getSentences = async () => {
      await sleep(0);
      return [];
    };
    const units = unitsOf("s0", "s1");
    const session = startSession({ deps, units, limits: sessionLimits });

    await vi.waitFor(() => expect(session.status()).toBe("paused"));

    expect(requests).toHaveLength(1);
    await sleep(20);
    expect(requests).toHaveLength(1);
    expect(session.progress()).toEqual({ done: 0, total: 2 });
  });

  it("finishes an empty book immediately", async () => {
    const { deps, requests } = memoryDeps();
    const session = startSession({ deps, units: [], limits: sessionLimits });

    await vi.waitFor(() => expect(session.status()).toBe("done"));

    expect(session.progress()).toEqual({ done: 0, total: 0 });
    expect(requests).toHaveLength(0);
  });
});
