// Import-time bridge from a bilingual EPUB sidecar to the reader's existing
// sentence cache. Keeping the book text source-only means all Zen, narration
// and KOReader unit-index logic stays unchanged.
import type { BilingualBook } from "./epub/bilingual";
import { createSentenceKeyMemo } from "./sentenceKey";
import type { ArticleStore } from "./store";
import type { SentenceCacheEntry, Settings } from "./types";
import { pairBilingualTranslation } from "./zenTranslationDisplay";

const IMPORT_MODEL = "quiosco-bilingual-import";

export async function seedImportedTranslations(args: {
  store: Pick<ArticleStore, "putSentences">;
  bilingual: BilingualBook;
  settings: Pick<Settings, "targetLanguage" | "rules">;
}): Promise<number> {
  if (
    normalizeLanguage(args.settings.targetLanguage) !==
    normalizeLanguage(args.bilingual.targetLanguage)
  ) {
    return 0;
  }

  const keyMemo = createSentenceKeyMemo({
    targetLanguage: args.settings.targetLanguage,
    rules: args.settings.rules,
  });
  const rulesHashValue = await keyMemo.rulesHash();
  const createdAt = Date.now();
  const entries = new Map<string, SentenceCacheEntry>();

  for (const pair of args.bilingual.entries) {
    const source = pair.source.trim();
    const translation = pair.translation.trim();
    if (!source || !translation) continue;

    const key = await keyMemo.keyFor(source);
    entries.set(key, {
      key,
      source,
      translation: pairBilingualTranslation(source, translation),
      targetLanguage: args.settings.targetLanguage,
      rulesHash: rulesHashValue,
      model: IMPORT_MODEL,
      createdAt,
    });
  }

  if (entries.size === 0) return 0;
  await args.store.putSentences([...entries.values()]);
  return entries.size;
}

function normalizeLanguage(value: string): string {
  return value.trim().toLowerCase();
}
