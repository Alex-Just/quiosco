import { describe, expect, it, vi } from "vitest";
import { ELEVENLABS_MODEL_ID, synthesizeElevenLabsMp3 } from "./elevenLabsTts";

describe("synthesizeElevenLabsMp3", () => {
  it("POSTs Flash v2.5 with the xi-api-key header", async () => {
    const fetchFn = vi.fn(async () => new Response(new Uint8Array([1, 2])));
    const audio = await synthesizeElevenLabsMp3(
      "Hola.",
      "voice-xyz",
      "secret",
      fetchFn,
    );
    expect(audio).toEqual(new Uint8Array([1, 2]));
    expect(fetchFn).toHaveBeenCalledWith(
      "https://api.elevenlabs.io/v1/text-to-speech/voice-xyz",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "xi-api-key": "secret",
        }),
      }),
    );
    const init = (fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(JSON.parse(String(init.body))).toEqual({
      text: "Hola.",
      model_id: ELEVENLABS_MODEL_ID,
    });
  });

  it("throws when the API key is missing", async () => {
    await expect(
      synthesizeElevenLabsMp3("Hola.", "voice-xyz", "  "),
    ).rejects.toThrow(/missing/i);
  });
});
