import { describe, expect, it, vi } from "vitest";
import {
  toggleZenOriginalListen,
  ZEN_PARAGRAPH_SPEECH_INDEX,
} from "./zenListenActions";

describe("toggleZenOriginalListen", () => {
  it("stops when this paragraph is already speaking", async () => {
    const stopSpeaking = vi.fn();
    const speakSentence = vi.fn(() => true);
    const setSpeaking = vi.fn();
    const speechRun = { current: 3 };

    await toggleZenOriginalListen({
      paragraph: 2,
      text: "Hola mundo suficientemente largo.",
      speaking: { paragraph: 2, sentenceIndex: ZEN_PARAGRAPH_SPEECH_INDEX },
      speechRun,
      setSpeaking,
      setHint: vi.fn(),
      canSpeak: () => true,
      speakSentence,
      stopSpeaking,
    });

    expect(stopSpeaking).toHaveBeenCalled();
    expect(speakSentence).not.toHaveBeenCalled();
    expect(setSpeaking).toHaveBeenCalledWith(null);
    expect(speechRun.current).toBe(4);
  });

  it("starts original-language speech for the paragraph", async () => {
    const stopSpeaking = vi.fn();
    const speakSentence = vi.fn(() => true);
    const setSpeaking = vi.fn();
    const speechRun = { current: 1 };

    await toggleZenOriginalListen({
      paragraph: 0,
      text: "Hola mundo suficientemente largo.",
      speaking: null,
      speechRun,
      setSpeaking,
      setHint: vi.fn(),
      canSpeak: () => true,
      speakSentence,
      stopSpeaking,
      originalLang: "es-ES",
    });

    expect(speakSentence).toHaveBeenCalledWith(
      "Hola mundo suficientemente largo.",
      "es-ES",
      expect.any(Object),
    );
    expect(setSpeaking).toHaveBeenCalledWith({
      paragraph: 0,
      sentenceIndex: ZEN_PARAGRAPH_SPEECH_INDEX,
    });
  });

  it("no-ops when there is no speakable text", async () => {
    const speakSentence = vi.fn(() => true);
    await toggleZenOriginalListen({
      paragraph: 0,
      text: "   ",
      speaking: null,
      speechRun: { current: 0 },
      setSpeaking: vi.fn(),
      setHint: vi.fn(),
      canSpeak: () => true,
      speakSentence,
      stopSpeaking: vi.fn(),
    });
    expect(speakSentence).not.toHaveBeenCalled();
  });
});
