import { describe, expect, it, vi } from "vitest";
import {
  EDGE_VOICE_ALVARO,
  EDGE_VOICE_ELVIRA,
  handleTts,
  MAX_TTS_TEXT_CHARS,
} from "./tts";

describe("handleTts", () => {
  it("rejects Edge voices outside the Castilian allowlist", async () => {
    const response = await handleTts(
      new Request("https://app.example/api/tts", {
        method: "POST",
        body: JSON.stringify({
          text: "Hola.",
          provider: "edge",
          voice: "en-US-JennyNeural",
        }),
      }),
    );
    expect(response.status).toBe(400);
  });

  it("rejects empty ElevenLabs voice id", async () => {
    const response = await handleTts(
      new Request("https://app.example/api/tts", {
        method: "POST",
        body: JSON.stringify({
          text: "Hola.",
          provider: "elevenlabs",
          voice: "  ",
        }),
      }),
      { env: { ELEVENLABS_API_KEY: "key" } },
    );
    expect(response.status).toBe(400);
  });

  it("rejects empty text", async () => {
    const response = await handleTts(
      new Request("https://app.example/api/tts", {
        method: "POST",
        body: JSON.stringify({
          text: "   ",
          provider: "edge",
          voice: EDGE_VOICE_ELVIRA,
        }),
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
          provider: "edge",
          voice: EDGE_VOICE_ALVARO,
        }),
      }),
    );
    expect(response.status).toBe(413);
  });

  it("returns audio/mpeg for Edge when synthesis succeeds", async () => {
    const synthesize = vi.fn(async () => new Uint8Array([1, 2, 3]));
    const response = await handleTts(
      new Request("https://app.example/api/tts", {
        method: "POST",
        body: JSON.stringify({
          text: "Hola mundo.",
          provider: "edge",
          voice: EDGE_VOICE_ELVIRA,
        }),
      }),
      { synthesize },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("audio/mpeg");
    expect(synthesize).toHaveBeenCalledWith(
      "Hola mundo.",
      "edge",
      EDGE_VOICE_ELVIRA,
    );
  });

  it("returns audio/mpeg for ElevenLabs when synthesis succeeds", async () => {
    const synthesize = vi.fn(async () => new Uint8Array([4, 5]));
    const response = await handleTts(
      new Request("https://app.example/api/tts", {
        method: "POST",
        body: JSON.stringify({
          text: "Hola.",
          provider: "elevenlabs",
          voice: "voice-xyz",
        }),
      }),
      { synthesize, env: { ELEVENLABS_API_KEY: "key" } },
    );
    expect(response.status).toBe(200);
    expect(synthesize).toHaveBeenCalledWith("Hola.", "elevenlabs", "voice-xyz");
  });

  it("maps missing ElevenLabs key to 502", async () => {
    const response = await handleTts(
      new Request("https://app.example/api/tts", {
        method: "POST",
        body: JSON.stringify({
          text: "Hola.",
          provider: "elevenlabs",
          voice: "voice-xyz",
        }),
      }),
      { env: { ELEVENLABS_API_KEY: "" } },
    );
    expect(response.status).toBe(502);
  });

  it("defaults omitted provider to edge for legacy clients", async () => {
    const synthesize = vi.fn(async () => new Uint8Array([1]));
    const response = await handleTts(
      new Request("https://app.example/api/tts", {
        method: "POST",
        body: JSON.stringify({ text: "Hola.", voice: EDGE_VOICE_ELVIRA }),
      }),
      { synthesize },
    );
    expect(response.status).toBe(200);
    expect(synthesize).toHaveBeenCalledWith(
      "Hola.",
      "edge",
      EDGE_VOICE_ELVIRA,
    );
  });
});
