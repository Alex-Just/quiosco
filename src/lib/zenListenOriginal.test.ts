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
  it("speaks the on-screen original stanza, not a mismatched original index", () => {
    // Translation Zen pages do not line up 1:1 with original paragraphs.
    expect(
      originalParagraphForZen({
        originalBody:
          "Unos trabajos muy necesarios que devolverán el esplendor.\n\nOtro párrafo del original distinto.",
        index: 0,
        screenParagraph:
          "🇪🇸 La licitación contempla un presupuesto de 817.953,48 euros, IVA incluido.\n\n🇷🇺 В тендере предусмотрен бюджет.",
      }),
    ).toBe(
      "La licitación contempla un presupuesto de 817.953,48 euros, IVA incluido.",
    );
  });

  it("falls back to the original body when the screen has no text", () => {
    expect(
      originalParagraphForZen({
        originalBody: "Primero.\n\nSegundo párrafo aquí con texto.",
        index: 1,
        screenParagraph: "",
      }),
    ).toBe("Segundo párrafo aquí con texto.");
  });
});
