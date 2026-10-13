// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { speakWithVoice } from "./speakWithVoice";
import { ORIGINAL_LANG, stopSpeaking } from "./speech";

describe("speakWithVoice abort", () => {
  afterEach(() => {
    stopSpeaking();
    vi.restoreAllMocks();
  });

  it("does not fall back to system when Stop aborts the Edge fetch", async () => {
    const speakSentence = vi.fn(() => true);
    const playEdge = vi.fn();
    let resolveFetch: ((blob: Blob) => void) | undefined;
    const fetchEdge = vi.fn(
      (_text: string, _voice: string, _token: string, signal?: AbortSignal) =>
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
      voice: "elvira",
      speakSentence,
      fetchEdgeAudio: fetchEdge,
      playEdgeAudio: playEdge,
    });

    await Promise.resolve();
    expect(fetchEdge).toHaveBeenCalled();
    stopSpeaking();

    const started = await pending;
    expect(started).toBe(false);
    expect(speakSentence).not.toHaveBeenCalled();
    expect(playEdge).not.toHaveBeenCalled();
    // Avoid hanging if abort wiring is broken.
    resolveFetch?.(new Blob([new Uint8Array([1])]));
  });
});
