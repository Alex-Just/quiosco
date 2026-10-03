import { describe, expect, it } from "vitest";
import {
  splitLeadingMarkers,
  splitSentences,
  stripSentenceMarkers,
} from "./sentences";

describe("splitSentences", () => {
  it("splits on sentence-ending punctuation", () => {
    expect(splitSentences("Hola mundo. ¿Qué tal? Bien.")).toEqual([
      "Hola mundo.",
      "¿Qué tal?",
      "Bien.",
    ]);
  });

  it("keeps common abbreviations inside a sentence", () => {
    expect(splitSentences("El Sr. García llegó ayer. Fue puntual.")).toEqual([
      "El Sr. García llegó ayer.",
      "Fue puntual.",
    ]);
  });

  it("keeps multi-dot abbreviations inside a sentence", () => {
    expect(
      splitSentences("Viajó a EE.UU. el año pasado. Volvió en junio."),
    ).toEqual(["Viajó a EE.UU. el año pasado.", "Volvió en junio."]);
  });

  it("keeps initials inside a sentence", () => {
    expect(splitSentences("J. R. Tolkien escribió esto. Es famoso.")).toEqual([
      "J. R. Tolkien escribió esto.",
      "Es famoso.",
    ]);
  });

  it("splits after an ellipsis", () => {
    expect(splitSentences("Primera parte… segunda parte.")).toEqual([
      "Primera parte…",
      "segunda parte.",
    ]);
  });

  it("returns the text unchanged when there is no terminal punctuation", () => {
    expect(splitSentences("Solo una frase sin punto")).toEqual([
      "Solo una frase sin punto",
    ]);
  });

  it("returns an empty list for blank input", () => {
    expect(splitSentences("   ")).toEqual([]);
  });
});

describe("stripSentenceMarkers", () => {
  it("drops a standalone paragraph number line", () => {
    expect(
      stripSentenceMarkers(
        "11\n🇪🇸 Incluso podrán superarse los 250/300 en Castellón y Tarragona.",
      ),
    ).toBe("Incluso podrán superarse los 250/300 en Castellón y Tarragona.");
  });

  it("drops numbered list markers", () => {
    expect(stripSentenceMarkers("1. El Gobierno anunció medidas.")).toBe(
      "El Gobierno anunció medidas.",
    );
    expect(stripSentenceMarkers("2) Fue puntual.")).toBe("Fue puntual.");
  });

  it("drops a leading flag emoji", () => {
    expect(stripSentenceMarkers("🇪🇸 Los rojos se activan a las 18.00.")).toBe(
      "Los rojos se activan a las 18.00.",
    );
  });

  it("drops number and flag together", () => {
    expect(stripSentenceMarkers("13\n🇷🇺 Обстановка ухудшается.")).toBe(
      "Обстановка ухудшается.",
    );
  });

  it("keeps a sentence that merely starts with a year", () => {
    expect(stripSentenceMarkers("2026 fue un año récord.")).toBe(
      "2026 fue un año récord.",
    );
  });

  it("keeps mid-sentence numbers and flags", () => {
    expect(stripSentenceMarkers("Superó los 250/300 en Castellón.")).toBe(
      "Superó los 250/300 en Castellón.",
    );
  });

  it("never returns an empty string", () => {
    expect(stripSentenceMarkers("11")).toBe("11");
    expect(stripSentenceMarkers("🇪🇸")).toBe("🇪🇸");
  });
});

describe("splitLeadingMarkers", () => {
  it("splits a standalone paragraph number from the sentence", () => {
    expect(
      splitLeadingMarkers("11\n🇪🇸 Incluso podrán superarse los 250/300."),
    ).toEqual({
      number: "11",
      text: "Incluso podrán superarse los 250/300.",
    });
  });

  it("splits a numbered list marker from the sentence", () => {
    expect(splitLeadingMarkers("1. El Gobierno anunció medidas.")).toEqual({
      number: "1",
      text: "El Gobierno anunció medidas.",
    });
  });

  it("reports no number when the sentence has none", () => {
    expect(splitLeadingMarkers("🇪🇸 Los rojos se activan a las 18.00.")).toEqual(
      {
        number: null,
        text: "Los rojos se activan a las 18.00.",
      },
    );
    expect(splitLeadingMarkers("2026 fue un año récord.")).toEqual({
      number: null,
      text: "2026 fue un año récord.",
    });
  });
});
