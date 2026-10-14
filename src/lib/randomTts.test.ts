import { describe, expect, it } from "vitest";
import { listTtsChoices, pickRandomTtsChoice } from "./randomTts";

describe("listTtsChoices", () => {
  it("always includes system", () => {
    expect(listTtsChoices({ token: "", elevenLabsVoiceId: "" })).toEqual([
      { ttsProvider: "system", edgeVoice: "elvira", elevenLabsVoiceId: "" },
    ]);
  });

  it("adds both Edge voices when a token is set", () => {
    const choices = listTtsChoices({
      token: "tok",
      elevenLabsVoiceId: "",
    });
    expect(choices).toEqual([
      { ttsProvider: "system", edgeVoice: "elvira", elevenLabsVoiceId: "" },
      { ttsProvider: "edge", edgeVoice: "elvira", elevenLabsVoiceId: "" },
      { ttsProvider: "edge", edgeVoice: "alvaro", elevenLabsVoiceId: "" },
    ]);
  });

  it("adds ElevenLabs only when token and voice id are set", () => {
    const choices = listTtsChoices({
      token: "tok",
      elevenLabsVoiceId: " voice-1 ",
    });
    expect(choices).toContainEqual({
      ttsProvider: "elevenlabs",
      edgeVoice: "elvira",
      elevenLabsVoiceId: "voice-1",
    });
    expect(
      listTtsChoices({ token: "", elevenLabsVoiceId: "voice-1" }),
    ).not.toContainEqual(
      expect.objectContaining({ ttsProvider: "elevenlabs" }),
    );
  });
});

describe("pickRandomTtsChoice", () => {
  it("picks by the injected random index", () => {
    const input = { token: "tok", elevenLabsVoiceId: "v" };
    const choices = listTtsChoices(input);
    expect(pickRandomTtsChoice(input, () => 0.99)).toEqual(
      choices[choices.length - 1],
    );
    expect(pickRandomTtsChoice(input, () => 0)).toEqual(choices[0]);
  });
});
