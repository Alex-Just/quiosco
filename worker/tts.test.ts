import { describe, expect, it, vi } from "vitest";
import {
  EDGE_VOICE_ALVARO,
  EDGE_VOICE_ELVIRA,
  handleTts,
  MAX_TTS_TEXT_CHARS,
} from "./tts";

describe("handleTts", () => {
  it("rejects voices outside the Castilian allowlist", async () => {
    const response = await handleTts(
      new Request("https://app.example/api/tts", {
        method: "POST",
        body: JSON.stringify({ text: "Hola.", voice: "en-US-JennyNeural" }),
      }),
    );
    expect(response.status).toBe(400);
  });

  it("rejects empty text", async () => {
    const response = await handleTts(
      new Request("https://app.example/api/tts", {
        method: "POST",
        body: JSON.stringify({ text: "   ", voice: EDGE_VOICE_ELVIRA }),
      }),
    );
    expect(response.status).toBe(400);
  });

  it("rejects oversize text with 413", async () => {
    const response = await handleTts(
      new Request("https://app.example/api/tts", {
        method: "POST",
        body: JSON.stringify({
          text: "x".repeat(MAX_TTS_TEXT_CHARS + 1),
          voice: EDGE_VOICE_ALVARO,
        }),
      }),
    );
    expect(response.status).toBe(413);
  });

  it("returns audio/mpeg when synthesis succeeds", async () => {
    const synthesize = vi.fn(async () => new Uint8Array([1, 2, 3]));
    const response = await handleTts(
      new Request("https://app.example/api/tts", {
        method: "POST",
        body: JSON.stringify({
          text: "Hola mundo.",
          voice: EDGE_VOICE_ELVIRA,
        }),
      }),
      { synthesize },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("audio/mpeg");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(
      new Uint8Array([1, 2, 3]),
    );
    expect(synthesize).toHaveBeenCalledWith("Hola mundo.", EDGE_VOICE_ELVIRA);
  });

  it("maps upstream synthesis failure to 502", async () => {
    const response = await handleTts(
      new Request("https://app.example/api/tts", {
        method: "POST",
        body: JSON.stringify({ text: "Hola.", voice: EDGE_VOICE_ELVIRA }),
      }),
      {
        synthesize: async () => {
          throw new Error("upstream down");
        },
      },
    );
    expect(response.status).toBe(502);
  });
});
