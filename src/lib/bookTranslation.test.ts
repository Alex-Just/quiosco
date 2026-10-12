import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthError, QuotaError } from "./apiErrors";
import type { BookSentenceUnit } from "./bookText";
import {
  type BookTranslationDeps,
  type BookTranslationSession,
  errorStatus,
  MAX_ATTEMPTS_PER_ANCHOR,
  readCachedTranslations,
  startBookTranslation,
  translateWindow,
} from "./bookTranslation";
import type { BookWindowLimits, WindowPlan } from "./bookWindow";
import type { SentenceCacheEntry } from "./types";

function u(text: string): BookSentenceUnit {
  return { paragraphIndex: 0, text, skipped: false };
}

function skip(text = "***"): BookSentenceUnit {
  return { paragraphIndex: 0, text, skipped: true };
}

function memoryDeps() {
  const map = new Map<string, SentenceCacheEntry>();
  const requests: Array<{ model: string; system: string; text: string }> = [];
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
      requests.push(request);
      return "1. Uno\n2. Dos";
    },
  };
  return { deps, map, requests };
}

/** Same text ⇒ same key, like the real content-addressed key memo. */
function keyForText(units: readonly BookSentenceUnit[]) {
  return async (unitIndex: number): Promise<string> =>
    `k:${units[unitIndex]?.text ?? ""}`;
}

/** Default args: the whole list as the window, no context, English/rules r1. */
function windowArgs(
  deps: BookTranslationDeps,
  units: readonly BookSentenceUnit[],
  plan: WindowPlan = {
    start: 0,
    end: units.length,
    contextBefore: [],
    contextAfter: [],
  },
) {
  return {
    deps,
    model: "m",
    system: "s",
    units,
    plan,
    keyFor: keyForText(units),
    targetLanguage: "English",
    rulesHashValue: "r1",
  };
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

/** Units for one book: one paragraph per nested string list, none skipped. */
function paragraphs(sentences: readonly (readonly string[])[]) {
  const units: BookSentenceUnit[] = [];
  const paragraphUnits = new Map<number, number[]>();
  sentences.forEach((texts, paragraphIndex) => {
    const indices: number[] = [];
    for (const text of texts) {
      indices.push(units.length);
      units.push({ paragraphIndex, text, skipped: false });
    }
    paragraphUnits.set(paragraphIndex, indices);
  });
  return { units, paragraphUnits };
}

/** The numbered sentences inside a request's <translate> block. */
function translateBlock(text: string): string {
  const match = /<translate>\n([\s\S]*?)\n<\/translate>/.exec(text);
  return match?.[1] ?? "";
}

const sessionLimits: BookWindowLimits = {
  maxChars: 20,
  maxSentences: 10,
  contextChars: 5,
  runwayChars: 10,
};
/** Windows of two 4-char sentences: the runway needs more than one pass. */
const narrowLimits: BookWindowLimits = { ...sessionLimits, maxChars: 8 };

const sessions: BookTranslationSession[] = [];

function startSession(args: {
  deps: BookTranslationDeps;
  units: readonly BookSentenceUnit[];
  paragraphUnits: ReadonlyMap<number, readonly number[]>;
  limits?: BookWindowLimits;
}): BookTranslationSession {
  const session = startBookTranslation({
    ...args,
    keyFor: async (unitIndex) => `k${unitIndex}`,
    model: "m",
    system: "s",
    targetLanguage: "English",
    rulesHashValue: "r1",
  });
  sessions.push(session);
  return session;
}

afterEach(() => {
  for (const session of sessions.splice(0)) session.dispose();
  vi.restoreAllMocks();
});

describe("errorStatus", () => {
  it("maps auth, quota, and anything else", () => {
    expect(errorStatus(new AuthError())).toBe("auth");
    expect(errorStatus(new QuotaError())).toBe("quota");
    expect(errorStatus(new Error("boom"))).toBe("paused");
    expect(errorStatus("nope")).toBe("paused");
  });
});

describe("readCachedTranslations", () => {
  it("returns verified hits and treats mismatches as misses", async () => {
    const units = [
      u("Hola."),
      u("Adiós."),
      u("Hola."),
      u("Mundo."),
      u("Reglas."),
      skip("Números"),
    ];
    const { deps, map } = memoryDeps();
    map.set(
      "k:Hola.",
      cacheEntry({ key: "k:Hola.", source: "Hola.", translation: "Hello." }),
    );
    // Wrong source for the key, wrong target language, wrong rules: misses.
    map.set(
      "k:Adiós.",
      cacheEntry({ key: "k:Adiós.", source: "Adiós?!", translation: "Bye" }),
    );
    map.set(
      "k:Mundo.",
      cacheEntry({
        key: "k:Mundo.",
        source: "Mundo.",
        translation: "World",
        targetLanguage: "Spanish",
      }),
    );
    map.set(
      "k:Reglas.",
      cacheEntry({
        key: "k:Reglas.",
        source: "Reglas.",
        translation: "Rules",
        rulesHash: "r0",
      }),
    );
    // Cached, but its unit is skipped: must not be requested or returned.
    map.set(
      "k:Números",
      cacheEntry({
        key: "k:Números",
        source: "Números",
        translation: "Numbers",
      }),
    );
    const getSentences = vi.spyOn(deps.store, "getSentences");

    const translations = await readCachedTranslations({
      store: deps.store,
      units,
      unitIndices: [0, 1, 2, 3, 4, 5],
      keyFor: keyForText(units),
      targetLanguage: "English",
      rulesHashValue: "r1",
    });

    // Identical texts share one key, so both of their indices are filled.
    expect(translations).toEqual(
      new Map([
        [0, "Hello."],
        [2, "Hello."],
      ]),
    );
    // One read, unique keys only, and nothing for the skipped unit.
    expect(getSentences).toHaveBeenCalledTimes(1);
    expect(getSentences).toHaveBeenCalledWith([
      "k:Hola.",
      "k:Adiós.",
      "k:Mundo.",
      "k:Reglas.",
    ]);
  });

  it("surfaces store failures", async () => {
    const units = [u("Hola.")];
    const store = {
      getSentences: async () => {
        throw new AuthError();
      },
    };
    await expect(
      readCachedTranslations({
        store,
        units,
        unitIndices: [0],
        keyFor: keyForText(units),
        targetLanguage: "English",
        rulesHashValue: "r1",
      }),
    ).rejects.toBeInstanceOf(AuthError);
  });
});

describe("translateWindow", () => {
  it("sends the tagged window and caches the accepted prefix", async () => {
    const { deps, map, requests } = memoryDeps();
    const units = [
      u("Antes."),
      u("También antes."),
      u("Uno."),
      skip(),
      u("Dos."),
      u("Tres."),
      u("Después."),
    ];
    const plan: WindowPlan = {
      start: 2,
      end: 6,
      contextBefore: ["Antes.", "También antes."],
      contextAfter: ["Después."],
    };
    vi.spyOn(Date, "now").mockReturnValue(1_234_567);

    const count = await translateWindow(windowArgs(deps, units, plan));

    // The reply "1. Uno\n2. Dos" only covers two of the three sentences.
    expect(count).toBe(2);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toEqual({
      model: "m",
      system: "s",
      text: [
        "<before>Antes.\nTambién antes.</before>",
        "<translate>\n1. Uno.\n2. Dos.\n3. Tres.\n</translate>",
        "<after>\nDespués.</after>",
      ].join("\n"),
    });
    // Exactly the accepted prefix is cached; "3. Tres" was never accepted.
    expect(map.size).toBe(2);
    expect(map.get("k:Uno.")).toEqual({
      key: "k:Uno.",
      source: "Uno.",
      translation: "Uno",
      targetLanguage: "English",
      rulesHash: "r1",
      model: "m",
      createdAt: 1_234_567,
    });
    expect(map.get("k:Dos.")).toEqual({
      key: "k:Dos.",
      source: "Dos.",
      translation: "Dos",
      targetLanguage: "English",
      rulesHash: "r1",
      model: "m",
      createdAt: 1_234_567,
    });
  });

  it("forwards the abort signal", async () => {
    const { deps } = memoryDeps();
    const signals: Array<AbortSignal | undefined> = [];
    deps.translate = async (_request, signal) => {
      signals.push(signal);
      return "1. Uno";
    };
    const controller = new AbortController();

    await translateWindow({
      ...windowArgs(deps, [u("Uno.")]),
      signal: controller.signal,
    });

    expect(signals).toEqual([controller.signal]);
  });

  it("stores only units whose key resolves", async () => {
    const { deps, map } = memoryDeps();
    const units = [u("Uno."), u("Dos.")];
    const keyFor = async (unitIndex: number): Promise<string> =>
      unitIndex === 1
        ? (undefined as unknown as string)
        : `k:${units[unitIndex]?.text ?? ""}`;

    const count = await translateWindow({ ...windowArgs(deps, units), keyFor });

    expect(count).toBe(1);
    expect([...map.keys()]).toEqual(["k:Uno."]);
  });

  it("treats a keyFor failure as a unit-level skip", async () => {
    const { deps, map } = memoryDeps();
    const units = [u("Uno."), u("Dos.")];
    const keyFor = async (unitIndex: number): Promise<string> => {
      if (unitIndex === 1) throw new Error("no key");
      return `k:${units[unitIndex]?.text ?? ""}`;
    };

    const count = await translateWindow({ ...windowArgs(deps, units), keyFor });

    expect(count).toBe(1);
    expect([...map.keys()]).toEqual(["k:Uno."]);
  });

  it("propagates translate rejections", async () => {
    const { deps, map } = memoryDeps();
    deps.translate = async () => {
      throw new QuotaError();
    };

    await expect(
      translateWindow(windowArgs(deps, [u("Uno.")])),
    ).rejects.toBeInstanceOf(QuotaError);
    expect(map.size).toBe(0);
  });
});

describe("startBookTranslation", () => {
  it("translates the window containing a missing anchor first", async () => {
    const { deps, map, pending } = deferredDeps();
    const { units, paragraphUnits } = paragraphs([["Uno.", "Dos.", "Tres"]]);
    const session = startSession({
      deps,
      units,
      paragraphUnits,
      limits: sessionLimits,
    });

    session.setAnchor(0);
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    expect(translateBlock(pendingAt(pending, 0).request.text)).toBe(
      "1. Uno.\n2. Dos.\n3. Tres",
    );

    pendingAt(pending, 0).resolve("1. Uno");
    await vi.waitFor(() => expect(map.has("k0")).toBe(true));
    expect(map.get("k0")).toMatchObject({
      key: "k0",
      source: "Uno.",
      translation: "Uno",
      targetLanguage: "English",
      rulesHash: "r1",
      model: "m",
    });
    // The loop continues from the first missing sentence.
    await vi.waitFor(() => expect(pending).toHaveLength(2));
    expect(session.status()).toBe("working");
  });

  it("does not request sentences already cached", async () => {
    const { deps, map, pending } = deferredDeps();
    map.set(
      "k0",
      cacheEntry({ key: "k0", source: "Uno.", translation: "One." }),
    );
    map.set(
      "k1",
      cacheEntry({ key: "k1", source: "Dos.", translation: "Two." }),
    );
    const { units, paragraphUnits } = paragraphs([
      ["Uno.", "Dos.", "Tres", "Cua."],
    ]);
    const session = startSession({
      deps,
      units,
      paragraphUnits,
      limits: sessionLimits,
    });

    session.setAnchor(0);
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    // The window starts after the cached run; the run itself may only appear
    // as source context, never as a requested sentence.
    const block = translateBlock(pendingAt(pending, 0).request.text);
    expect(block).toBe("1. Tres\n2. Cua.");
    expect(block).not.toContain("Uno.");
    expect(block).not.toContain("Dos.");
  });

  it("stops once the runway ahead is covered", async () => {
    const { deps, map, pending } = deferredDeps();
    const { units, paragraphUnits } = paragraphs([
      ["Uno.", "Dos.", "Tres", "Cua.", "Cin."],
    ]);
    const session = startSession({
      deps,
      units,
      paragraphUnits,
      limits: narrowLimits,
    });

    session.setAnchor(0);
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    pendingAt(pending, 0).resolve("1. Uno.\n2. Dos.");
    await vi.waitFor(() => expect(pending).toHaveLength(2));
    pendingAt(pending, 1).resolve("1. Tres\n2. Cua.");

    await vi.waitFor(() => expect(session.status()).toBe("idle"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(pending).toHaveLength(2);
    // 12 cached chars cover the 10-char runway; the fifth sentence stays out.
    expect(map.has("k4")).toBe(false);
  });

  it("resumes at the first missing sentence after a partial response", async () => {
    const { deps, map, pending } = deferredDeps();
    const { units, paragraphUnits } = paragraphs([["Uno.", "Dos.", "Tres"]]);
    const session = startSession({
      deps,
      units,
      paragraphUnits,
      limits: narrowLimits,
    });

    session.setAnchor(0);
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    pendingAt(pending, 0).resolve("1. Uno");
    await vi.waitFor(() => expect(pending).toHaveLength(2));
    expect(translateBlock(pendingAt(pending, 1).request.text)).toBe(
      "1. Dos.\n2. Tres",
    );
    expect([...map.keys()]).toEqual(["k0"]);
  });

  it("pauses on a rejected request and resumes after retry()", async () => {
    const { deps, map, pending } = deferredDeps();
    const { units, paragraphUnits } = paragraphs([["Uno.", "Dos.", "Tres"]]);
    const session = startSession({
      deps,
      units,
      paragraphUnits,
      limits: sessionLimits,
    });

    session.setAnchor(0);
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    pendingAt(pending, 0).reject(new Error("boom"));
    await vi.waitFor(() => expect(session.status()).toBe("paused"));
    expect(pending).toHaveLength(1);

    session.retry();
    await vi.waitFor(() => expect(session.status()).toBe("working"));
    await vi.waitFor(() => expect(pending).toHaveLength(2));
    // Nothing was cached, so the retry re-requests the same window.
    expect(translateBlock(pendingAt(pending, 1).request.text)).toBe(
      "1. Uno.\n2. Dos.\n3. Tres",
    );
    pendingAt(pending, 1).resolve("1. Uno.\n2. Dos.\n3. Tres");
    await vi.waitFor(() => expect(map.size).toBe(3));
    await vi.waitFor(() => expect(session.status()).toBe("idle"));
  });

  for (const [label, error] of [
    ["auth", new AuthError()],
    ["quota", new QuotaError()],
  ] as const) {
    it(`keeps ${label} failures sticky`, async () => {
      const { deps, pending } = deferredDeps();
      const { units, paragraphUnits } = paragraphs([
        ["Uno.", "Dos."],
        ["Tres", "Cua."],
      ]);
      const session = startSession({
        deps,
        units,
        paragraphUnits,
        limits: sessionLimits,
      });

      session.setAnchor(0);
      await vi.waitFor(() => expect(pending).toHaveLength(1));
      pendingAt(pending, 0).reject(error);
      await vi.waitFor(() => expect(session.status()).toBe(label));

      // Neither retry() nor a new anchor revives the session.
      session.retry();
      session.setAnchor(1);
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(session.status()).toBe(label);
      expect(pending).toHaveLength(1);
    });
  }

  it("lets an in-flight request finish when the new anchor is inside its plan", async () => {
    const { deps, pending } = deferredDeps();
    const { units, paragraphUnits } = paragraphs([
      ["Uno.", "Dos."],
      ["Tres", "Cua."],
      ["Cin.", "Siete"],
      ["Ocho.", "Nueve"],
    ]);
    const session = startSession({
      deps,
      units,
      paragraphUnits,
      limits: sessionLimits,
    });

    session.setAnchor(0);
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    expect(translateBlock(pendingAt(pending, 0).request.text)).toBe(
      "1. Uno.\n2. Dos.\n3. Tres\n4. Cua.\n5. Cin.",
    );

    // Paragraph 2 anchors at unit 4, inside the [0, 5) window.
    session.setAnchor(2);
    expect(pendingAt(pending, 0).signal?.aborted).toBe(false);

    pendingAt(pending, 0).resolve(
      "1. Uno.\n2. Dos.\n3. Tres\n4. Cua.\n5. Cin.",
    );
    await vi.waitFor(() => expect(pending).toHaveLength(2));
    // Re-planned from the new anchor: the cached prefix is skipped.
    expect(translateBlock(pendingAt(pending, 1).request.text)).toBe(
      "1. Siete\n2. Ocho.\n3. Nueve",
    );
    expect(session.status()).toBe("working");
  });

  it("aborts and re-anchors when the new anchor is beyond the in-flight plan", async () => {
    const { deps, pending } = deferredDeps();
    const { units, paragraphUnits } = paragraphs([
      ["Uno.", "Dos."],
      ["Tres", "Cua."],
      ["Cin.", "Siete"],
      ["Ocho.", "Nueve"],
    ]);
    const session = startSession({
      deps,
      units,
      paragraphUnits,
      limits: sessionLimits,
    });

    session.setAnchor(0);
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    // Paragraph 3 anchors at unit 6, beyond the [0, 5) window.
    session.setAnchor(3);
    expect(pendingAt(pending, 0).signal?.aborted).toBe(true);

    await vi.waitFor(() => expect(pending).toHaveLength(2));
    expect(translateBlock(pendingAt(pending, 1).request.text)).toBe(
      "1. Ocho.\n2. Nueve",
    );
    // The aborted request never leaves a failure status behind.
    expect(session.status()).toBe("working");
  });

  it("stops at MAX_ATTEMPTS_PER_ANCHOR and continues on retry()", async () => {
    const { deps, map, pending } = deferredDeps();
    const { units, paragraphUnits } = paragraphs([
      ["a0", "a1", "a2", "a3", "a4", "a5", "a6", "a7"],
    ]);
    const session = startSession({
      deps,
      units,
      paragraphUnits,
      limits: narrowLimits,
    });

    session.setAnchor(0);
    for (let attempt = 0; attempt < MAX_ATTEMPTS_PER_ANCHOR; attempt++) {
      await vi.waitFor(() => expect(pending).toHaveLength(attempt + 1));
      expect(translateBlock(pendingAt(pending, attempt).request.text)).toBe(
        `1. a${attempt}\n2. a${attempt + 1}\n3. a${attempt + 2}\n4. a${attempt + 3}`,
      );
      // One accepted sentence per window: progress, but never coverage.
      pendingAt(pending, attempt).resolve(`1. a${attempt}`);
    }

    await vi.waitFor(() => expect(session.status()).toBe("idle"));
    expect(pending).toHaveLength(MAX_ATTEMPTS_PER_ANCHOR);
    expect([...map.keys()]).toEqual(["k0", "k1", "k2"]);

    // The next kick continues from where it left off, first missing first.
    session.retry();
    await vi.waitFor(() => expect(pending).toHaveLength(4));
    expect(translateBlock(pendingAt(pending, 3).request.text)).toBe(
      "1. a3\n2. a4\n3. a5\n4. a6",
    );
    expect(session.status()).toBe("working");
  });

  it("dispose() aborts the in-flight request and stops updates", async () => {
    const { deps, pending } = deferredDeps();
    const { units, paragraphUnits } = paragraphs([["Uno.", "Dos."], ["Tres"]]);
    const session = startSession({
      deps,
      units,
      paragraphUnits,
      limits: sessionLimits,
    });
    let updates = 0;
    session.onUpdate(() => {
      updates += 1;
    });

    session.setAnchor(0);
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    expect(updates).toBeGreaterThan(0);

    session.dispose();
    expect(pendingAt(pending, 0).signal?.aborted).toBe(true);
    const seen = updates;
    session.retry();
    session.setAnchor(1);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(updates).toBe(seen);
    expect(pending).toHaveLength(1);
  });

  it("fires onUpdate after every cache write and status change", async () => {
    const { deps, pending } = deferredDeps();
    const { units, paragraphUnits } = paragraphs([["Uno.", "Dos."]]);
    const session = startSession({
      deps,
      units,
      paragraphUnits,
      limits: narrowLimits,
    });
    let updates = 0;
    session.onUpdate(() => {
      updates += 1;
    });

    session.setAnchor(0); // working
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    pendingAt(pending, 0).resolve("1. Uno."); // first cache write
    await vi.waitFor(() => expect(pending).toHaveLength(2));
    pendingAt(pending, 1).resolve("1. Dos."); // second cache write
    await vi.waitFor(() => expect(session.status()).toBe("idle"));
    expect(updates).toBe(4);
  });

  it("stops calling an unsubscribed listener", async () => {
    const { deps, pending } = deferredDeps();
    const { units, paragraphUnits } = paragraphs([["Uno."]]);
    const session = startSession({
      deps,
      units,
      paragraphUnits,
      limits: narrowLimits,
    });
    let updates = 0;
    const off = session.onUpdate(() => {
      updates += 1;
    });

    session.setAnchor(0); // working
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    expect(updates).toBe(1);
    off();
    pendingAt(pending, 0).resolve("1. Uno.");
    await vi.waitFor(() => expect(session.status()).toBe("idle"));
    expect(updates).toBe(1);
  });

  it("stops dispatching to later listeners when one disposes", async () => {
    const { deps, pending } = deferredDeps();
    const { units, paragraphUnits } = paragraphs([["Uno."]]);
    const session = startSession({
      deps,
      units,
      paragraphUnits,
      limits: narrowLimits,
    });
    let later = 0;
    session.onUpdate(() => session.dispose());
    session.onUpdate(() => {
      later += 1;
    });

    session.setAnchor(0);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(later).toBe(0);
    expect(pending).toHaveLength(0);
  });

  it("honors retry() issued by a listener on the paused notice", async () => {
    const { deps, map, pending } = deferredDeps();
    const { units, paragraphUnits } = paragraphs([["Uno.", "Dos.", "Tres"]]);
    const session = startSession({
      deps,
      units,
      paragraphUnits,
      limits: sessionLimits,
    });
    session.onUpdate(() => {
      if (session.status() === "paused") session.retry();
    });

    session.setAnchor(0);
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    pendingAt(pending, 0).reject(new Error("boom"));

    // The listener retries while the loop is still finishing its exit; the
    // kick must survive and start a fresh run.
    await vi.waitFor(() => expect(pending).toHaveLength(2));
    expect(session.status()).toBe("working");
    pendingAt(pending, 1).resolve("1. Uno.\n2. Dos.\n3. Tres");
    await vi.waitFor(() => expect(map.size).toBe(3));
    await vi.waitFor(() => expect(session.status()).toBe("idle"));
  });

  it("honors setAnchor() issued by a listener on the paused notice", async () => {
    const { deps, pending } = deferredDeps();
    const { units, paragraphUnits } = paragraphs([
      ["Uno.", "Dos.", "Tres"],
      ["Cua.", "Cin."],
    ]);
    const session = startSession({
      deps,
      units,
      paragraphUnits,
      limits: sessionLimits,
    });
    session.onUpdate(() => {
      if (session.status() === "paused") session.setAnchor(1);
    });

    session.setAnchor(0);
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    pendingAt(pending, 0).reject(new Error("boom"));

    // The loop must restart re-planned at the new anchor.
    await vi.waitFor(() => expect(pending).toHaveLength(2));
    expect(translateBlock(pendingAt(pending, 1).request.text)).toBe(
      "1. Cua.\n2. Cin.",
    );
    expect(session.status()).toBe("working");
  });

  it("honors setAnchor() issued by a listener on the cap-idle notice", async () => {
    const { deps, pending } = deferredDeps();
    const { units, paragraphUnits } = paragraphs([
      ["a0", "a1", "a2", "a3", "a4", "a5", "a6", "a7"],
      ["b0", "b1", "b2", "b3"],
    ]);
    const session = startSession({
      deps,
      units,
      paragraphUnits,
      limits: narrowLimits,
    });
    session.onUpdate(() => {
      if (session.status() === "idle") session.setAnchor(1);
    });

    session.setAnchor(0);
    for (let attempt = 0; attempt < MAX_ATTEMPTS_PER_ANCHOR; attempt++) {
      await vi.waitFor(() => expect(pending).toHaveLength(attempt + 1));
      pendingAt(pending, attempt).resolve(`1. a${attempt}`);
    }

    // The cap idles the loop; the listener's re-anchor restarts it there.
    await vi.waitFor(() => expect(pending).toHaveLength(4));
    expect(translateBlock(pendingAt(pending, 3).request.text)).toBe(
      "1. b0\n2. b1\n3. b2\n4. b3",
    );
    expect(session.status()).toBe("working");
  });

  it("does not treat an abort-restart as a standing kick", async () => {
    const { deps, pending } = deferredDeps();
    const { units, paragraphUnits } = paragraphs([
      ["Uno.", "Dos."],
      ["Tres", "Cua."],
      ["Cin.", "Siete"],
      ["Ocho.", "Nueve"],
    ]);
    const session = startSession({
      deps,
      units,
      paragraphUnits,
      limits: sessionLimits,
    });

    session.setAnchor(0);
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    // The kick that restarts at the new anchor is consumed by that restart; a
    // later failure must still stop the loop without a further request.
    session.setAnchor(3);
    await vi.waitFor(() => expect(pending).toHaveLength(2));
    pendingAt(pending, 1).reject(new Error("boom"));
    await vi.waitFor(() => expect(session.status()).toBe("paused"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(pending).toHaveLength(2);
  });
});
