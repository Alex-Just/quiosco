import { describe, expect, it } from "vitest";
import {
  GOOGLE_ES_VOICE_NAME,
  isCancellation,
  ORIGINAL_LANG,
  pickSpeechVoice,
  speechLangFor,
} from "./speech";

describe("speechLangFor", () => {
  it("maps the common target languages to BCP-47 codes", () => {
    expect(speechLangFor("English")).toBe("en-US");
    expect(speechLangFor("Spanish")).toBe("es-ES");
    expect(speechLangFor("español")).toBe("es-ES");
    expect(speechLangFor("French")).toBe("fr-FR");
  });

  it("is case-insensitive and trims whitespace", () => {
    expect(speechLangFor("  english ")).toBe("en-US");
  });

  it("returns an empty string for unknown languages", () => {
    expect(speechLangFor("Klingon")).toBe("");
  });

  it("exposes the original-article language", () => {
    expect(ORIGINAL_LANG).toBe("es-ES");
  });
});

describe("pickSpeechVoice", () => {
  const voices = [
    { name: "Spanish Spain", lang: "es-ES" },
    { name: GOOGLE_ES_VOICE_NAME, lang: "es-ES" },
    { name: "Google US English", lang: "en-US" },
  ];

  it("prefers Google español for Castilian", () => {
    expect(pickSpeechVoice(ORIGINAL_LANG, voices)?.name).toBe(
      GOOGLE_ES_VOICE_NAME,
    );
  });

  it("falls back to any Google es-ES voice when the exact name is missing", () => {
    const withoutExact = [
      { name: "Spanish Spain", lang: "es-ES" },
      { name: "Google español de España", lang: "es-ES" },
    ];
    expect(pickSpeechVoice("es-ES", withoutExact)?.name).toBe(
      "Google español de España",
    );
  });

  it("returns null when no Castilian Google voice is listed", () => {
    expect(
      pickSpeechVoice(ORIGINAL_LANG, [
        { name: "Spanish Spain", lang: "es-ES" },
      ]),
    ).toBeNull();
    expect(pickSpeechVoice("en-US", voices)).toBeNull();
  });
});

describe("isCancellation", () => {
  it("treats user and browser cancellations as expected, not as failures", () => {
    expect(isCancellation("canceled")).toBe(true);
    expect(isCancellation("interrupted")).toBe(true);
  });

  it("does not treat real synthesis failures as cancellations", () => {
    expect(isCancellation("voice-unavailable")).toBe(false);
    expect(isCancellation("synthesis-failed")).toBe(false);
    expect(isCancellation("not-allowed")).toBe(false);
  });
});
