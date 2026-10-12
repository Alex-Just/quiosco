import { describe, expect, it } from "vitest";
import {
  originalParagraphForZen,
  speakableOriginalParagraph,
} from "./zenListenOriginal";

describe("speakableOriginalParagraph", () => {
  it("strips flags and numbers for speech", () => {
    expect(
      speakableOriginalParagraph("🇪🇸 Entre las infracciones más habituales."),
    ).toBe("Entre las infracciones más habituales.");
  });

  it("keeps only the first language stanza from a bilingual screen", () => {
    expect(
      speakableOriginalParagraph(
        "🇪🇸 Entre las infracciones más habituales.\n\n🇷🇺 Среди нарушений.",
      ),
    ).toBe("Entre las infracciones más habituales.");
  });

  it("returns empty for blank input", () => {
    expect(speakableOriginalParagraph("   ")).toBe("");
  });
});

describe("originalParagraphForZen", () => {
  it("reads the matching original paragraph", () => {
    expect(
      originalParagraphForZen({
        originalBody: "Primero.\n\nSegundo párrafo aquí.",
        index: 1,
      }),
    ).toBe("Segundo párrafo aquí.");
  });

  it("falls back to the on-screen paragraph when original is short", () => {
    expect(
      originalParagraphForZen({
        originalBody: "Solo uno.",
        index: 1,
        screenParagraph:
          "🇪🇸 Entre las infracciones más habituales.\n\n🇷🇺 Среди нарушений.",
      }),
    ).toBe("Entre las infracciones más habituales.");
  });
});
