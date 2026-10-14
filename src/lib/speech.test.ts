import { describe, expect, it } from "vitest";
import {
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
  it("prefers the default voice for the requested language", () => {
    const voices = [
      { name: "Google español", lang: "es-ES", default: false },
      { name: "RHVoice Spanish", lang: "es-ES", default: true },
      { name: "Google US English", lang: "en-US", default: true },
    ];
    expect(pickSpeechVoice(ORIGINAL_LANG, voices)?.name).toBe(
      "RHVoice Spanish",
    );
  });

  it("returns null when no default matches so the OS engine can choose", () => {
    const voices = [
      { name: "Google español", lang: "es-ES", default: false },
      { name: "Spanish Spain", lang: "es-ES", default: false },
    ];
    expect(pickSpeechVoice(ORIGINAL_LANG, voices)).toBeNull();
    expect(pickSpeechVoice("en-US", voices)).toBeNull();
  });

  it("does not force a Google voice over another engine default", () => {
    const voices = [
      { name: "Google español", lang: "es-ES", default: false },
      { name: "Tetsy es-ES", lang: "es-ES", default: true },
    ];
    expect(pickSpeechVoice("es-ES", voices)?.name).toBe("Tetsy es-ES");
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
