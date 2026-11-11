import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  collectOpencodeText,
  openTranslationCache,
  parseModelRef,
  type TranslationCache,
  translateUnits,
} from "../scripts/lib/translateEpub";
import type { BookSentenceUnit } from "../src/lib/bookText";
import { rulesHash, sentenceCacheKey } from "../src/lib/sentenceKey";
import type { SentenceCacheEntry } from "../src/lib/types";

const RULES = "Keep the bilingual table.";
const TARGET = "Russian";

function unit(text: string, paragraphIndex = 0): BookSentenceUnit {
  return { paragraphIndex, text, skipped: false };
}

function memoryCache(initial: readonly SentenceCacheEntry[] = []): {
  cache: TranslationCache;
  entries: Map<string, SentenceCacheEntry>;
} {
  const entries = new Map(initial.map((entry) => [entry.key, entry]));
  return {
    entries,
    cache: {
      get: (key) => entries.get(key),
      set: (entry) => {
        entries.set(entry.key, entry);
      },
      save: async () => undefined,
    },
  };
}

function reply(
  sentences: readonly string[],
  translations: readonly string[],
): string {
  return sentences
    .map(
      (sentence, index) =>
        `${index + 1}\n🇪🇸 ${sentence}\n🇷🇺 ${translations[index] ?? ""}`,
    )
    .join("\n\n");
}

describe("parseModelRef", () => {
  it("splits provider and model", () => {
    expect(parseModelRef("opencode/deepseek-v4.1-flash-free")).toEqual({
      providerID: "opencode",
      id: "deepseek-v4.1-flash-free",
    });
  });

  it("rejects a model without a provider", () => {
    expect(() => parseModelRef("deepseek-v4.1-flash-free")).toThrow(
      /provider\/model/,
    );
  });
});

describe("collectOpencodeText", () => {
  it("returns only assistant text events", () => {
    const stdout = [
      JSON.stringify({ type: "step_start" }),
      JSON.stringify({
        type: "text",
        part: { type: "text", text: "1\n🇷🇺 Привет." },
      }),
      JSON.stringify({ type: "step_finish" }),
    ].join("\n");

    expect(collectOpencodeText(stdout)).toBe("1\n🇷🇺 Привет.");
  });

  it("surfaces an error event", () => {
    const stdout = JSON.stringify({
      type: "error",
      error: { message: "model unavailable" },
    });
    expect(() => collectOpencodeText(stdout)).toThrow(/model unavailable/);
  });

  it("rejects a reply with no text", () => {
    expect(() =>
      collectOpencodeText(JSON.stringify({ type: "step_finish" })),
    ).toThrow(/no text/);
  });
});

describe("openTranslationCache", () => {
  it("persists entries and reloads them", async () => {
    const directory = await mkdtemp(join(tmpdir(), "quiosco-cache-"));
    try {
      const path = join(directory, "cache.json");
      const entry: SentenceCacheEntry = {
        key: "a".repeat(64),
        source: "Hola.",
        translation: "🇪🇸 Hola.\n🇷🇺 Привет.",
        targetLanguage: TARGET,
        rulesHash: "b".repeat(64),
        model: "opencode/deepseek-v4.1-flash-free",
        createdAt: 1,
      };

      const cache = await openTranslationCache(path);
      expect(cache.get(entry.key)).toBeUndefined();
      cache.set(entry);
      await cache.save();

      const reopened = await openTranslationCache(path);
      expect(reopened.get(entry.key)).toEqual(entry);
      expect(JSON.parse(await readFile(path, "utf8")).version).toBe(1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects corrupt JSON with an actionable message", async () => {
    const directory = await mkdtemp(join(tmpdir(), "quiosco-cache-"));
    try {
      const path = join(directory, "cache.json");
      await writeFile(path, "{not json", "utf8");
      await expect(openTranslationCache(path)).rejects.toThrow(
        /not valid JSON/,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("merges entries written by another cache instance", async () => {
    const directory = await mkdtemp(join(tmpdir(), "quiosco-cache-"));
    try {
      const path = join(directory, "cache.json");
      const first: SentenceCacheEntry = {
        key: "a".repeat(64),
        source: "Uno.",
        translation: "🇪🇸 Uno.\n🇷🇺 Один.",
        targetLanguage: TARGET,
        rulesHash: "c".repeat(64),
        model: "test",
        createdAt: 1,
      };
      const second: SentenceCacheEntry = {
        key: "b".repeat(64),
        source: "Dos.",
        translation: "🇪🇸 Dos.\n🇷🇺 Два.",
        targetLanguage: TARGET,
        rulesHash: "c".repeat(64),
        model: "test",
        createdAt: 2,
      };

      const one = await openTranslationCache(path);
      const two = await openTranslationCache(path);
      one.set(first);
      await one.save();
      two.set(second);
      await two.save();

      const reopened = await openTranslationCache(path);
      expect(reopened.get(first.key)).toEqual(first);
      expect(reopened.get(second.key)).toEqual(second);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("keeps a repaired on-disk entry it did not change", async () => {
    const directory = await mkdtemp(join(tmpdir(), "quiosco-cache-"));
    try {
      const path = join(directory, "cache.json");
      const key = "a".repeat(64);
      const empty: SentenceCacheEntry = {
        key,
        source: "Uno.",
        translation: "",
        targetLanguage: TARGET,
        rulesHash: "c".repeat(64),
        model: "test",
        createdAt: 1,
      };
      await writeFile(
        path,
        JSON.stringify({ version: 1, entries: { [key]: empty } }),
        "utf8",
      );

      const one = await openTranslationCache(path);
      const two = await openTranslationCache(path);
      const repaired = { ...empty, translation: "🇪🇸 Uno.\n🇷🇺 Один." };
      two.set(repaired);
      await two.save();

      const other: SentenceCacheEntry = {
        ...empty,
        key: "b".repeat(64),
        source: "Dos.",
        translation: "🇪🇸 Dos.\n🇷🇺 Два.",
      };
      one.set(other);
      await one.save();

      const reopened = await openTranslationCache(path);
      expect(reopened.get(key)).toEqual(repaired);
      expect(reopened.get(other.key)).toEqual(other);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects an unsupported cache version", async () => {
    const directory = await mkdtemp(join(tmpdir(), "quiosco-cache-"));
    try {
      const path = join(directory, "cache.json");
      await writeFile(
        path,
        JSON.stringify({ version: 99, entries: {} }),
        "utf8",
      );
      await expect(openTranslationCache(path)).rejects.toThrow(
        /unsupported version/,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe("translateUnits", () => {
  it("translates a window, pairs the source and caches every sentence", async () => {
    const units = [unit("Hola."), unit("Adiós.")];
    const { cache, entries } = memoryCache();
    let prompt = "";

    const result = await translateUnits({
      units,
      system: "SYSTEM",
      targetLanguage: TARGET,
      rules: RULES,
      model: "opencode/deepseek-v4.1-flash-free",
      cache,
      translate: async (nextPrompt) => {
        prompt = nextPrompt;
        return reply(["Hola.", "Adiós."], ["Привет.", "Пока."]);
      },
    });

    expect(prompt).toContain("SYSTEM");
    expect(prompt).toContain("<translate>\n1. Hola.\n2. Adiós.\n</translate>");
    expect(result.complete).toBe(true);
    expect(result.windows).toBe(1);
    expect(result.translations.get(0)).toBe("🇪🇸 Hola.\n🇷🇺 Привет.");
    expect(result.translations.get(1)).toBe("🇪🇸 Adiós.\n🇷🇺 Пока.");
    expect(entries.size).toBe(2);

    const key = await sentenceCacheKey("Hola.", {
      targetLanguage: TARGET,
      rules: RULES,
    });
    expect(entries.get(key)?.translation).toBe("🇪🇸 Hola.\n🇷🇺 Привет.");
  });

  it("resumes from a partial window and asks only for the missing sentence", async () => {
    const units = [unit("Hola."), unit("Adiós.")];
    const { cache } = memoryCache();
    const prompts: string[] = [];
    const translate = async (prompt: string): Promise<string> => {
      prompts.push(prompt);
      return prompts.length === 1
        ? reply(["Hola."], ["Привет."])
        : reply(["Adiós."], ["Пока."]);
    };

    const first = await translateUnits({
      units,
      system: "SYSTEM",
      targetLanguage: TARGET,
      rules: RULES,
      model: "opencode/deepseek-v4.1-flash-free",
      cache,
      translate,
      maxWindows: 1,
    });
    expect(first.complete).toBe(false);
    expect(first.translations.size).toBe(1);

    const second = await translateUnits({
      units,
      system: "SYSTEM",
      targetLanguage: TARGET,
      rules: RULES,
      model: "opencode/deepseek-v4.1-flash-free",
      cache,
      translate,
    });

    expect(second.complete).toBe(true);
    expect(second.translations.size).toBe(2);
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain("<translate>\n1. Adiós.\n</translate>");
    expect(prompts[1]).not.toContain("1. Hola.");
  });

  it("does not re-request a cached sentence inside a window", async () => {
    const units = [unit("A"), unit("B"), unit("C")];
    const key = await sentenceCacheKey("B", {
      targetLanguage: TARGET,
      rules: RULES,
    });
    const cached: SentenceCacheEntry = {
      key,
      source: "B",
      translation: "🇪🇸 B\n🇷🇺 Б",
      targetLanguage: TARGET,
      rulesHash: await rulesHash(RULES),
      model: "old",
      createdAt: 0,
    };
    const { cache } = memoryCache([cached]);
    let prompt = "";

    const result = await translateUnits({
      units,
      system: "SYSTEM",
      targetLanguage: TARGET,
      rules: RULES,
      model: "opencode/deepseek-v4.1-flash-free",
      cache,
      translate: async (nextPrompt) => {
        prompt = nextPrompt;
        return reply(["A", "C"], ["А", "Ц"]);
      },
    });

    expect(prompt).toContain("<translate>\n1. A\n2. C\n</translate>");
    expect(prompt).not.toContain("1. B");
    expect(result.complete).toBe(true);
    expect(result.translations.get(1)).toBe(cached.translation);
  });

  it("retries a reply that accepted no sentences", async () => {
    const units = [unit("Hola.")];
    const { cache } = memoryCache();
    let calls = 0;

    const result = await translateUnits({
      units,
      system: "SYSTEM",
      targetLanguage: TARGET,
      rules: RULES,
      model: "opencode/deepseek-v4.1-flash-free",
      cache,
      retryDelayMs: 0,
      translate: async () => {
        calls += 1;
        return calls === 1
          ? "no numbered entries"
          : reply(["Hola."], ["Привет."]);
      },
    });

    expect(calls).toBe(2);
    expect(result.complete).toBe(true);
  });

  it("ignores an empty cached translation", async () => {
    const units = [unit("Hola.")];
    const key = await sentenceCacheKey("Hola.", {
      targetLanguage: TARGET,
      rules: RULES,
    });
    const { cache } = memoryCache([
      {
        key,
        source: "Hola.",
        translation: "   ",
        targetLanguage: TARGET,
        rulesHash: await rulesHash(RULES),
        model: "old",
        createdAt: 0,
      },
    ]);
    let calls = 0;

    const result = await translateUnits({
      units,
      system: "SYSTEM",
      targetLanguage: TARGET,
      rules: RULES,
      model: "opencode/deepseek-v4.1-flash-free",
      cache,
      translate: async () => {
        calls += 1;
        return reply(["Hola."], ["Привет."]);
      },
    });

    expect(calls).toBe(1);
    expect(result.translations.get(0)).toBe("🇪🇸 Hola.\n🇷🇺 Привет.");
  });

  it("ignores a cache entry for another target language", async () => {
    const units = [unit("Hola.")];
    const key = await sentenceCacheKey("Hola.", {
      targetLanguage: TARGET,
      rules: RULES,
    });
    const { cache } = memoryCache([
      {
        key,
        source: "Hola.",
        translation: "Hello.",
        targetLanguage: "English",
        rulesHash: "stale",
        model: "old",
        createdAt: 0,
      },
    ]);
    let calls = 0;

    const result = await translateUnits({
      units,
      system: "SYSTEM",
      targetLanguage: TARGET,
      rules: RULES,
      model: "opencode/deepseek-v4.1-flash-free",
      cache,
      translate: async () => {
        calls += 1;
        return reply(["Hola."], ["Привет."]);
      },
    });

    expect(calls).toBe(1);
    expect(result.translations.get(0)).toBe("🇪🇸 Hola.\n🇷🇺 Привет.");
  });
});
