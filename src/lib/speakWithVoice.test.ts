// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { speakWithVoice } from "./speakWithVoice";
import { ORIGINAL_LANG, stopSpeaking } from "./speech";

describe("speakWithVoice", () => {
  afterEach(() => {
    stopSpeaking();
    vi.restoreAllMocks();
  });

  it("uses the system engine for voice=system", async () => {
    const speakSentence = vi.fn(() => true);
    const fetchEdge = vi.fn();
    const playEdge = vi.fn();
    await speakWithVoice({
      text: "Hola.",
      lang: ORIGINAL_LANG,
      token: "tok",
      voice: "system",
      speakSentence,
      fetchEdgeAudio: fetchEdge,
      playEdgeAudio: playEdge,
    });
    expect(speakSentence).toHaveBeenCalled();
    expect(fetchEdge).not.toHaveBeenCalled();
  });

  it("uses the system engine for non-Spanish language", async () => {
    const speakSentence = vi.fn(() => true);
    const fetchEdge = vi.fn();
    await speakWithVoice({
      text: "Hello.",
      lang: "en-US",
      token: "tok",
      voice: "elvira",
      speakSentence,
      fetchEdgeAudio: fetchEdge,
      playEdgeAudio: vi.fn(),
    });
    expect(speakSentence).toHaveBeenCalled();
    expect(fetchEdge).not.toHaveBeenCalled();
  });

  it("uses the system engine when the app token is missing", async () => {
    const speakSentence = vi.fn(() => true);
    const fetchEdge = vi.fn();
    await speakWithVoice({
      text: "Hola.",
      lang: ORIGINAL_LANG,
      token: "",
      voice: "elvira",
      speakSentence,
      fetchEdgeAudio: fetchEdge,
      playEdgeAudio: vi.fn(),
    });
    expect(speakSentence).toHaveBeenCalled();
    expect(fetchEdge).not.toHaveBeenCalled();
  });

  it("plays Edge audio for Elvira on es-ES", async () => {
    const speakSentence = vi.fn(() => true);
    const blob = new Blob([new Uint8Array([1])], { type: "audio/mpeg" });
    const fetchEdge = vi.fn(async () => blob);
    const playEdge = vi.fn(async () => undefined);
    const started = await speakWithVoice({
      text: "Hola.",
      lang: ORIGINAL_LANG,
      token: "tok",
      voice: "elvira",
      speakSentence,
      fetchEdgeAudio: fetchEdge,
      playEdgeAudio: playEdge,
    });
    expect(started).toBe(true);
    expect(fetchEdge).toHaveBeenCalled();
    expect(playEdge).toHaveBeenCalledWith(blob, expect.any(Object));
    expect(speakSentence).not.toHaveBeenCalled();
  });

  it("falls back to system when Edge fails", async () => {
    const speakSentence = vi.fn(() => true);
    const started = await speakWithVoice({
      text: "Hola.",
      lang: ORIGINAL_LANG,
      token: "tok",
      voice: "alvaro",
      speakSentence,
      fetchEdgeAudio: async () => {
        throw new Error("down");
      },
      playEdgeAudio: vi.fn(),
    });
    expect(started).toBe(true);
    expect(speakSentence).toHaveBeenCalled();
  });
});
