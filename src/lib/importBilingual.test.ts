import { describe, expect, it } from "vitest";
import { seedImportedTranslations } from "./importBilingual";
import { sentenceCacheKey } from "./sentenceKey";
import type { SentenceCacheEntry } from "./types";

function fakeStore() {
  const entries: SentenceCacheEntry[] = [];
  return {
    entries,
    store: {
      async putSentences(next: readonly SentenceCacheEntry[]) {
        entries.push(...next);
      },
    },
  };
}

describe("seedImportedTranslations", () => {
  it("seeds one cache entry per unique source with flags and current rules", async () => {
    const { entries, store } = fakeStore();
    const settings = { targetLanguage: "Russian", rules: "r" };
    const count = await seedImportedTranslations({
      store,
      settings,
      bilingual: {
        targetLanguage: "Russian",
        entries: [
          { source: "Hola.", translation: "🇷🇺 Привет." },
          { source: "Hola.", translation: "🇷🇺 Привет." },
        ],
      },
    });

    expect(count).toBe(1);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.key).toBe(await sentenceCacheKey("Hola.", settings));
    expect(entries[0]?.translation).toBe("🇪🇸 Hola.\n🇷🇺 Привет.");
  });

  it("pairs a flagless target-only sidecar entry", async () => {
    const { entries, store } = fakeStore();
    const count = await seedImportedTranslations({
      store,
      settings: { targetLanguage: "Russian", rules: "r" },
      bilingual: {
        targetLanguage: "Russian",
        entries: [{ source: "Hola.", translation: "Привет." }],
      },
    });

    expect(count).toBe(1);
    expect(entries[0]?.translation).toBe("🇪🇸 Hola.\nПривет.");
  });

  it("does nothing when the sidecar target differs from the settings", async () => {
    const { entries, store } = fakeStore();
    const count = await seedImportedTranslations({
      store,
      settings: { targetLanguage: "Russian", rules: "r" },
      bilingual: {
        targetLanguage: "English",
        entries: [{ source: "Hola.", translation: "Hello." }],
      },
    });

    expect(count).toBe(0);
    expect(entries).toHaveLength(0);
  });
});
