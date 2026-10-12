import { describe, expect, it } from "vitest";
import {
  createSentenceKeyMemo,
  normalizeSentence,
  rulesHash,
  sentenceCacheKey,
} from "./sentenceKey";

const material = { targetLanguage: "English", rules: "No flags." };

describe("sentenceCacheKey", () => {
  it("is stable for the same sentence and material", async () => {
    const a = await sentenceCacheKey("Hola, mundo.", material);
    const b = await sentenceCacheKey("Hola,  mundo.", material);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes with the sentence, language, or rules", async () => {
    const base = await sentenceCacheKey("Hola.", material);
    expect(await sentenceCacheKey("Adiós.", material)).not.toBe(base);
    expect(
      await sentenceCacheKey("Hola.", {
        ...material,
        targetLanguage: "Russian",
      }),
    ).not.toBe(base);
    expect(
      await sentenceCacheKey("Hola.", { ...material, rules: "Other." }),
    ).not.toBe(base);
  });
});

describe("normalizeSentence", () => {
  it("strips leading numbers/flags and collapses whitespace", () => {
    expect(normalizeSentence("12 🇪🇸 Hola.\n  Adiós.")).toBe("Hola. Adiós.");
  });
});

describe("createSentenceKeyMemo", () => {
  it("computes each distinct text once", async () => {
    const memo = createSentenceKeyMemo(material);
    const [a, b] = await Promise.all([
      memo.keyFor("Hola."),
      memo.keyFor("Hola."),
    ]);
    expect(a).toBe(b);
    expect(await memo.keyFor("Hola.")).toBe(a);
  });
});

describe("rulesHash", () => {
  it("hashes the pinned rules material to lowercase hex", async () => {
    const hash = await rulesHash("No flags.");
    expect(hash).toBe(
      "4a9df820e5d56ebe491f2b94a49d4d02465fff8027d85fb49a75142cbc7169c1",
    );
    expect(await rulesHash("Other.")).not.toBe(hash);
  });

  it("is memoized on the session memo", async () => {
    const memo = createSentenceKeyMemo(material);
    expect(await memo.rulesHash()).toBe(await rulesHash(material.rules));
    expect(await memo.rulesHash()).toBe(await memo.rulesHash());
  });
});
