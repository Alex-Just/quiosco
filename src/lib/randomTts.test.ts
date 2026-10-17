import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createTtsPicker,
  listTtsChoices,
  pickNextTtsChoice,
  type TtsChoice,
} from "./randomTts";

/** Random source that yields each value once, then repeats the last. */
function sequence(values: readonly number[]): () => number {
  let index = 0;
  return () => {
    const value = values[Math.min(index, values.length - 1)];
    index += 1;
    return value ?? 0.99;
  };
}

function choiceKey(choice: TtsChoice): string {
  return `${choice.ttsProvider}|${choice.edgeVoice}|${choice.elevenLabsVoiceId}`;
}

const SYSTEM_CHOICE: TtsChoice = {
  ttsProvider: "system",
  edgeVoice: "elvira",
  elevenLabsVoiceId: "",
};

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

describe("createTtsPicker", () => {
  it("deals every available voice once per cycle before repeating", () => {
    const input = { token: "tok", elevenLabsVoiceId: "v" };
    const all = listTtsChoices(input);
    const picker = createTtsPicker(sequence([0.99]));
    const picks = Array.from({ length: all.length * 2 }, () =>
      picker.pick(input),
    );
    const firstCycle = picks.slice(0, all.length);
    const secondCycle = picks.slice(all.length);
    expect(new Set(firstCycle.map(choiceKey)).size).toBe(all.length);
    expect(new Set(secondCycle.map(choiceKey)).size).toBe(all.length);
    expect(new Set(picks.map(choiceKey))).toEqual(new Set(all.map(choiceKey)));
  });

  it("never deals the same voice twice in a row across cycles", () => {
    const input = { token: "tok", elevenLabsVoiceId: "v" };
    const picker = createTtsPicker(sequence([0.99, 0.99, 0.99, 0.1, 0.7, 0.7]));
    const picks = Array.from({ length: 5 }, () => picker.pick(input));
    expect(picks[4]).not.toEqual(picks[3]);
  });

  it("keeps dealing the sole voice when only system is available", () => {
    const picker = createTtsPicker(sequence([0.99]));
    const picks = Array.from({ length: 3 }, () =>
      picker.pick({ token: "", elevenLabsVoiceId: "" }),
    );
    expect(picks).toEqual([SYSTEM_CHOICE, SYSTEM_CHOICE, SYSTEM_CHOICE]);
  });

  it("drops voices that are no longer available when the set changes", () => {
    const picker = createTtsPicker(sequence([0.99]));
    picker.pick({ token: "tok", elevenLabsVoiceId: "v" });
    const picks = Array.from({ length: 5 }, () =>
      picker.pick({ token: "tok", elevenLabsVoiceId: "" }),
    );
    expect(
      picks.filter((choice) => choice.ttsProvider === "elevenlabs"),
    ).toEqual([]);
  });
});

describe("pickNextTtsChoice", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps one shuffle bag across calls within a page load", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.99);
    const input = { token: "tok", elevenLabsVoiceId: "v" };
    const first = pickNextTtsChoice(input);
    const second = pickNextTtsChoice(input);
    expect(second).not.toEqual(first);
  });
});
