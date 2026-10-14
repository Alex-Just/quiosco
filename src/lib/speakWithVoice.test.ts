// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { speakWithVoice } from "./speakWithVoice";
import { ORIGINAL_LANG, stopSpeaking } from "./speech";

const base = {
  text: "Hola.",
  lang: ORIGINAL_LANG,
  token: "tok",
  edgeVoice: "elvira" as const,
  elevenLabsVoiceId: "",
  rate: 1.25,
};

describe("speakWithVoice", () => {
  afterEach(() => {
    stopSpeaking();
    vi.restoreAllMocks();
  });

  it("uses the system engine for provider=system", async () => {
    const speakSentence = vi.fn(() => true);
    const fetchTts = vi.fn();
    await speakWithVoice({
      ...base,
      ttsProvider: "system",
      speakSentence,
      fetchTtsAudio: fetchTts,
      playEdgeAudio: vi.fn(),
    });
    expect(speakSentence).toHaveBeenCalledWith(
      "Hola.",
      "es-ES",
      expect.any(Object),
      1.25,
    );
    expect(fetchTts).not.toHaveBeenCalled();
  });

  it("uses the system engine when ElevenLabs voice id is empty", async () => {
    const speakSentence = vi.fn(() => true);
    const fetchTts = vi.fn();
    await speakWithVoice({
      ...base,
      ttsProvider: "elevenlabs",
      elevenLabsVoiceId: "  ",
      speakSentence,
      fetchTtsAudio: fetchTts,
      playEdgeAudio: vi.fn(),
    });
    expect(speakSentence).toHaveBeenCalledWith(
      "Hola.",
      "es-ES",
      expect.any(Object),
      1.25,
    );
    expect(fetchTts).not.toHaveBeenCalled();
  });

  it("plays Edge audio for provider=edge", async () => {
    const speakSentence = vi.fn(() => true);
    const blob = new Blob([new Uint8Array([1])], { type: "audio/mpeg" });
    const fetchTts = vi.fn(async () => blob);
    const playEdge = vi.fn(async () => undefined);
    const started = await speakWithVoice({
      ...base,
      ttsProvider: "edge",
      speakSentence,
      fetchTtsAudio: fetchTts,
      playEdgeAudio: playEdge,
    });
    expect(started).toBe(true);
    expect(fetchTts).toHaveBeenCalledWith(
      "Hola.",
      "edge",
      "es-ES-ElviraNeural",
      1.25,
      "tok",
      expect.any(AbortSignal),
    );
    expect(speakSentence).not.toHaveBeenCalled();
  });

  it("plays ElevenLabs audio for provider=elevenlabs with a voice id", async () => {
    const speakSentence = vi.fn(() => true);
    const blob = new Blob([new Uint8Array([1])], { type: "audio/mpeg" });
    const fetchTts = vi.fn(async () => blob);
    const playEdge = vi.fn(async () => undefined);
    await speakWithVoice({
      ...base,
      ttsProvider: "elevenlabs",
      elevenLabsVoiceId: "voice-xyz",
      speakSentence,
      fetchTtsAudio: fetchTts,
      playEdgeAudio: playEdge,
    });
    expect(fetchTts).toHaveBeenCalledWith(
      "Hola.",
      "elevenlabs",
      "voice-xyz",
      1.25,
      "tok",
      expect.any(AbortSignal),
    );
    expect(speakSentence).not.toHaveBeenCalled();
  });

  it("falls back to system when cloud TTS fails", async () => {
    const speakSentence = vi.fn(() => true);
    const started = await speakWithVoice({
      ...base,
      ttsProvider: "edge",
      speakSentence,
      fetchTtsAudio: async () => {
        throw new Error("down");
      },
      playEdgeAudio: vi.fn(),
    });
    expect(started).toBe(true);
    expect(speakSentence).toHaveBeenCalledWith(
      "Hola.",
      "es-ES",
      expect.any(Object),
      1.25,
    );
  });
});
