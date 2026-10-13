/**
 * Node CI has no localStorage. These tests must stay on the default Vitest
 * environment (not jsdom) so a bare `localStorage` default parameter fails
 * the same way GitHub Actions does.
 */
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, loadSettings } from "./settings";
import {
  toggleZenOriginalListen,
  ZEN_PARAGRAPH_SPEECH_INDEX,
} from "./zenListenActions";

describe("settings without browser storage", () => {
  function withoutLocalStorage(run: () => void | Promise<void>): Promise<void> {
    const descriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      "localStorage",
    );
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new ReferenceError("localStorage is not defined");
      },
    });
    return Promise.resolve(run()).finally(() => {
      if (descriptor) {
        Object.defineProperty(globalThis, "localStorage", descriptor);
      } else {
        Reflect.deleteProperty(globalThis, "localStorage");
      }
    });
  }

  it("loadSettings does not throw when localStorage is missing", async () => {
    await withoutLocalStorage(() => {
      expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    });
  });

  it("toggleZenOriginalListen works when localStorage is missing", async () => {
    await withoutLocalStorage(async () => {
      const speakSentence = vi.fn(() => true);
      const setSpeaking = vi.fn();
      await toggleZenOriginalListen({
        paragraph: 0,
        text: "Hola mundo suficientemente largo.",
        speaking: null,
        speechRun: { current: 0 },
        setSpeaking,
        setHint: vi.fn(),
        canSpeak: () => true,
        speakSentence,
        stopSpeaking: vi.fn(),
        ttsProvider: "system",
        edgeVoice: "elvira",
        elevenLabsVoiceId: "",
        token: "",
      });
      expect(speakSentence).toHaveBeenCalled();
      expect(setSpeaking).toHaveBeenCalledWith({
        paragraph: 0,
        sentenceIndex: ZEN_PARAGRAPH_SPEECH_INDEX,
      });
    });
  });
});
