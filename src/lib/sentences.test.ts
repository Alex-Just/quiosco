import { describe, expect, it } from "vitest";
import { splitSentences } from "./sentences";

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
