import { describe, expect, it, vi } from "vitest";
import {
  EDGE_VOICE_ELVIRA,
  edgeVoiceToEdgeName,
  fetchTtsAudio,
} from "./edgeTts";

describe("edgeVoiceToEdgeName", () => {
  it("maps Elvira and Álvaro to Edge neural names", () => {
    expect(edgeVoiceToEdgeName("elvira")).toBe(EDGE_VOICE_ELVIRA);
    expect(edgeVoiceToEdgeName("alvaro")).toBe("es-ES-AlvaroNeural");
  });
});

describe("fetchTtsAudio", () => {
  it("POSTs provider, text, voice, and rate with the app token", async () => {
    const fetchFn = vi.fn(async () => {
      return new Response(new Uint8Array([9, 9]), {
        status: 200,
        headers: { "content-type": "audio/mpeg" },
      });
    });
    const blob = await fetchTtsAudio(
      "Hola.",
      "elevenlabs",
      "voice-xyz",
      1.2,
      "tok",
      undefined,
      fetchFn,
    );
    expect(await blob.arrayBuffer()).toEqual(new Uint8Array([9, 9]).buffer);
    const body = (fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1]
      .body;
    expect(JSON.parse(String(body))).toEqual({
      text: "Hola.",
      provider: "elevenlabs",
      voice: "voice-xyz",
      rate: 1.2,
    });
  });

  it("throws when the Worker rejects the request", async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: "nope" }), { status: 502 }),
    );
    await expect(
      fetchTtsAudio(
        "Hola.",
        "edge",
        EDGE_VOICE_ELVIRA,
        1,
        "tok",
        undefined,
        fetchFn,
      ),
    ).rejects.toThrow(/502/);
  });
});
