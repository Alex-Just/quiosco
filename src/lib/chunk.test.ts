import { describe, expect, it } from "vitest";
import { chunkText } from "./chunk";

const normalized = (text: string) => text.replace(/\s+/g, " ").trim();
const sentence = (i: number) => `Esta es la frase número ${i} de la noticia.`;

describe("chunkText", () => {
  it("returns [] for empty text", () => {
    expect(chunkText("   ")).toEqual([]);
  });

  it("returns a single chunk when under the limit", () => {
    const text = "Un párrafo corto.";
    expect(chunkText(text)).toEqual([text]);
  });

  it("keeps exactly-maxChars text in one chunk", () => {
    const text = "a".repeat(12_000);
    expect(chunkText(text)).toHaveLength(1);
  });

  it("splits large multi-paragraph text into chunks <= maxChars", () => {
    const paragraph = Array.from({ length: 20 }, (_, i) => sentence(i)).join(
      " ",
    );
    const text = Array.from({ length: 20 }, () => paragraph).join("\n\n");
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks)
      expect(chunk.length).toBeLessThanOrEqual(12_000);
    expect(normalized(chunks.join("\n\n"))).toBe(normalized(text));
  });

  it("prefers paragraph boundaries", () => {
    const paragraph = "x".repeat(9_000);
    const chunks = chunkText(`${paragraph}\n\n${paragraph}\n\n${paragraph}`);
    expect(chunks).toHaveLength(3);
    for (const chunk of chunks) expect(chunk).toBe(paragraph);
  });

  it("splits a single oversized paragraph at sentence boundaries", () => {
    const text = Array.from({ length: 300 }, (_, i) => sentence(i)).join(" ");
    const chunks = chunkText(text, 1_000);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(1_000);
      expect(chunk.trimEnd().endsWith(".")).toBe(true);
    }
  });

  it("hard-slices a sentence with no punctuation", () => {
    const text = "y".repeat(25_000);
    const chunks = chunkText(text);
    expect(chunks).toHaveLength(3);
    for (const chunk of chunks)
      expect(chunk.length).toBeLessThanOrEqual(12_000);
  });
});
