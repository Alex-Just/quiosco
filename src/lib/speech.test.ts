// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isCancellation,
  ORIGINAL_LANG,
  speakSentence,
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

describe("speakSentence", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** jsdom ships neither speechSynthesis nor the utterance constructor. */
  function stubSynthesis(): { lang: string; rate: number }[] {
    const spoken: { lang: string; rate: number }[] = [];
    class FakeUtterance {
      lang = "";
      rate = 1;
      onend: (() => void) | null = null;
      onerror: ((event: { error: string }) => void) | null = null;
      constructor(public text: string) {}
    }
    vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
    vi.stubGlobal("speechSynthesis", {
      cancel: vi.fn(),
      speak: (utterance: { lang: string; rate: number }) =>
        spoken.push(utterance),
    });
    return spoken;
  }

  it("sets the requested rate on the system utterance", () => {
    const spoken = stubSynthesis();
    expect(speakSentence("Hola.", ORIGINAL_LANG, {}, 1.5)).toBe(true);
    expect(spoken[0]?.lang).toBe(ORIGINAL_LANG);
    expect(spoken[0]?.rate).toBe(1.5);
  });

  it("leaves the rate at the browser default when it is unusable", () => {
    const spoken = stubSynthesis();
    speakSentence("Hola.", ORIGINAL_LANG, {}, Number.NaN);
    expect(spoken[0]?.rate).toBe(1);
  });
});
