import { describe, expect, it } from "vitest";
import {
  splitLeadingMarkers,
  splitLeadingNumber,
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

  it("keeps a dialogue tag with the sentence it closes", () => {
    expect(
      splitSentences("—¡Ah, qué tragedia! —dijo Hermione. —Lo sé."),
    ).toEqual(["—¡Ah, qué tragedia! —dijo Hermione.", "—Lo sé."]);
  });

  it("keeps an interrupting dialogue tag inside the sentence", () => {
    expect(splitSentences("—¿Vienes? —preguntó—. —Enseguida.")).toEqual([
      "—¿Vienes? —preguntó—.",
      "—Enseguida.",
    ]);
  });

  it("merges dialogue tags in any language", () => {
    expect(splitSentences("—Привет! —сказал он. —Пока.")).toEqual([
      "—Привет! —сказал он.",
      "—Пока.",
    ]);
  });

  it("still splits a new dialogue line after a closing tag", () => {
    expect(splitSentences("—Vamos. —De acuerdo.")).toEqual([
      "—Vamos.",
      "—De acuerdo.",
    ]);
    expect(splitSentences("Llegó tarde. —¿Vienes?")).toEqual([
      "Llegó tarde.",
      "—¿Vienes?",
    ]);
  });

  it("splits bilingual stanzas at each language flag", () => {
    expect(
      splitSentences(
        "🇪🇸 La conexión con Barcelona está peor: la combinación más rápida supera las 7 horas debido a un Corredor aún inacabado\n🇷🇺 С сообщением в Барселону дела обстоят хуже: самый быстрый вариант занимает более 7 часов.",
      ),
    ).toEqual([
      "🇪🇸 La conexión con Barcelona está peor: la combinación más rápida supera las 7 horas debido a un Corredor aún inacabado",
      "🇷🇺 С сообщением в Барселону дела обстоят хуже: самый быстрый вариант занимает более 7 часов.",
    ]);
  });

  it("keeps a leading number with the first flag stanza", () => {
    expect(splitSentences("20\n🇪🇸 Hola mundo\n🇷🇺 Привет мир")).toEqual([
      "20\n🇪🇸 Hola mundo",
      "🇷🇺 Привет мир",
    ]);
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

describe("splitLeadingNumber", () => {
  it("keeps the flag in the displayed text", () => {
    expect(
      splitLeadingNumber(
        '2\n🇪🇸 "No me preguntaron si quería volver a Marruecos.',
      ),
    ).toEqual({
      number: "2",
      text: '🇪🇸 "No me preguntaron si quería volver a Marruecos.',
    });
  });

  it("drops a numbered list marker", () => {
    expect(splitLeadingNumber("1. El Gobierno anunció medidas.")).toEqual({
      number: "1",
      text: "El Gobierno anunció medidas.",
    });
  });

  it("keeps the newline when the flag sits on its own line", () => {
    expect(
      splitLeadingNumber("4\n🇪🇸\nLos migrantes llevaban en la ciudad."),
    ).toEqual({
      number: "4",
      text: "🇪🇸\nLos migrantes llevaban en la ciudad.",
    });
  });

  it("reports no number when the sentence has none", () => {
    expect(
      splitLeadingNumber('🇪🇸 "No me preguntaron si quería volver."'),
    ).toEqual({
      number: null,
      text: '🇪🇸 "No me preguntaron si quería volver."',
    });
  });

  it("drops a bare number before a same-line flag", () => {
    expect(
      splitLeadingNumber("3 🇪🇸 Esto explica en gran parte la escasa demanda."),
    ).toEqual({
      number: "3",
      text: "🇪🇸 Esto explica en gran parte la escasa demanda.",
    });
  });
});
