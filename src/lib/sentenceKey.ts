// Content-addressed cache keys for sentence translations. Hashing the exact
// source text under the target language and translation rules lets any device
// reuse another's cached translations: same inputs, same key, no coordination.
import { stripSentenceMarkers } from "./sentences";

export interface BookTranslationMaterial {
  targetLanguage: string;
  rules: string;
}

/** Paragraph numbers, language flags and layout whitespace do not change what
 * a sentence says, so they are dropped before hashing. */
export function normalizeSentence(source: string): string {
  return stripSentenceMarkers(source).replace(/\s+/g, " ").trim();
}

async function sha256Hex(material: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(material),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export function sentenceCacheKey(
  source: string,
  material: BookTranslationMaterial,
): Promise<string> {
  return sha256Hex(
    `quiosco:book:v1\n${material.targetLanguage}\n${material.rules}\n${normalizeSentence(source)}`,
  );
}

export function rulesHash(rules: string): Promise<string> {
  return sha256Hex(`quiosco:book:rules:v1\n${rules}`);
}

export interface SentenceKeyMemo {
  keyFor(text: string): Promise<string>;
  rulesHash(): Promise<string>;
}

/** Reuses keys, including in-flight hashes, for the lifetime of one session. */
export function createSentenceKeyMemo(
  material: BookTranslationMaterial,
): SentenceKeyMemo {
  const keys = new Map<string, Promise<string>>();
  let cachedRulesHash: Promise<string> | undefined;
  return {
    keyFor(text: string): Promise<string> {
      const existing = keys.get(text);
      if (existing) return existing;
      const key = sentenceCacheKey(text, material);
      keys.set(text, key);
      return key;
    },
    rulesHash(): Promise<string> {
      // Module-level rulesHash, not this method.
      cachedRulesHash ??= rulesHash(material.rules);
      return cachedRulesHash;
    },
  };
}
