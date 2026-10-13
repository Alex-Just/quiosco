import { describe, expect, it, vi } from "vitest";
import {
  ELEVENLABS_LANGUAGE_CODE,
  ELEVENLABS_MODEL_ID,
  ELEVENLABS_OUTPUT_FORMAT,
  synthesizeElevenLabsMp3,
} from "./elevenLabsTts";

describe("synthesizeElevenLabsMp3", () => {
  it("POSTs Turbo v2.5 with Spanish language_code and output_format", async () => {
    const fetchFn = vi.fn(async () => new Response(new Uint8Array([1, 2])));
    const audio = await synthesizeElevenLabsMp3(
      "Hola.",
      "voice-xyz",
      "secret",
      fetchFn,
    );
    expect(audio).toEqual(new Uint8Array([1, 2]));
    expect(fetchFn).toHaveBeenCalledWith(
      `https://api.elevenlabs.io/v1/text-to-speech/voice-xyz?output_format=${ELEVENLABS_OUTPUT_FORMAT}`,
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
      language_code: ELEVENLABS_LANGUAGE_CODE,
    });
    expect(ELEVENLABS_MODEL_ID).toBe("eleven_turbo_v2_5");
    expect(ELEVENLABS_LANGUAGE_CODE).toBe("es");
  });

  it("includes upstream detail when the request fails", async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            detail: {
              code: "paid_plan_required",
              message: "Free users cannot use library voices via the API.",
            },
          }),
          { status: 402 },
        ),
    );
    await expect(
      synthesizeElevenLabsMp3("Hola.", "voice-xyz", "secret", fetchFn),
    ).rejects.toThrow(/402.*library voices/i);
  });

  it("throws when the API key is missing", async () => {
    await expect(
      synthesizeElevenLabsMp3("Hola.", "voice-xyz", "  "),
    ).rejects.toThrow(/missing/i);
  });
});
