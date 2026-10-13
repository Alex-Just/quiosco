import { describe, expect, it, vi } from "vitest";
import {
  EDGE_VOICE_ALVARO,
  EDGE_VOICE_ELVIRA,
  fetchEdgeTtsAudio,
  settingsVoiceToEdgeName,
} from "./edgeTts";

describe("settingsVoiceToEdgeName", () => {
  it("maps Elvira and Álvaro to Edge neural names", () => {
    expect(settingsVoiceToEdgeName("elvira")).toBe(EDGE_VOICE_ELVIRA);
    expect(settingsVoiceToEdgeName("alvaro")).toBe(EDGE_VOICE_ALVARO);
  });

  it("returns null for system", () => {
    expect(settingsVoiceToEdgeName("system")).toBeNull();
  });
});

describe("fetchEdgeTtsAudio", () => {
  it("POSTs text and voice with the app token", async () => {
    const fetchFn = vi.fn(async () => {
      return new Response(new Uint8Array([9, 9]), {
        status: 200,
        headers: { "content-type": "audio/mpeg" },
      });
    });
    const blob = await fetchEdgeTtsAudio(
      "Hola.",
      EDGE_VOICE_ELVIRA,
      "tok",
      undefined,
      fetchFn,
    );
    expect(await blob.arrayBuffer()).toEqual(new Uint8Array([9, 9]).buffer);
    expect(fetchFn).toHaveBeenCalledWith(
      "/api/tts",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer tok",
        }),
      }),
    );
    const body = (fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1]
      .body;
    expect(JSON.parse(String(body))).toEqual({
      text: "Hola.",
      voice: EDGE_VOICE_ELVIRA,
    });
  });

  it("throws when the Worker rejects the request", async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: "nope" }), { status: 502 }),
    );
    await expect(
      fetchEdgeTtsAudio("Hola.", EDGE_VOICE_ALVARO, "tok", undefined, fetchFn),
    ).rejects.toThrow(/502/);
  });
});
