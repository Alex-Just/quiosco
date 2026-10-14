// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { speakWithVoice } from "./speakWithVoice";
import { ORIGINAL_LANG, stopSpeaking } from "./speech";

describe("speakWithVoice abort", () => {
  afterEach(() => {
    stopSpeaking();
    vi.restoreAllMocks();
  });

  it("does not fall back to system when Stop aborts the TTS fetch", async () => {
    const speakSentence = vi.fn(() => true);
    const playEdge = vi.fn();
    let resolveFetch: ((blob: Blob) => void) | undefined;
    const fetchTts = vi.fn(
      (
        _text: string,
        _provider: "edge" | "elevenlabs",
        _voice: string,
        _rate: number,
        _token: string,
        signal?: AbortSignal,
      ) =>
        new Promise<Blob>((resolve, reject) => {
          resolveFetch = resolve;
          signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
    );

    const pending = speakWithVoice({
      text: "Hola página larga.",
      lang: ORIGINAL_LANG,
      token: "tok",
      ttsProvider: "elevenlabs",
      edgeVoice: "elvira",
      elevenLabsVoiceId: "voice-xyz",
      rate: 1,
      speakSentence,
      fetchTtsAudio: fetchTts,
      playEdgeAudio: playEdge,
    });

    await Promise.resolve();
    expect(fetchTts).toHaveBeenCalled();
    stopSpeaking();

    const started = await pending;
    expect(started).toBe(false);
    expect(speakSentence).not.toHaveBeenCalled();
    expect(playEdge).not.toHaveBeenCalled();
    resolveFetch?.(new Blob([new Uint8Array([1])]));
  });
});
