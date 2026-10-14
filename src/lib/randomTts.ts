import type { EdgeVoiceSetting, TtsProvider } from "./types";

/** One playable (provider, voice) pair for random TTS. */
export type TtsChoice = {
  ttsProvider: TtsProvider;
  edgeVoice: EdgeVoiceSetting;
  elevenLabsVoiceId: string;
};

const EDGE_VOICES: readonly EdgeVoiceSetting[] = ["elvira", "alvaro"];

/**
 * Playable TTS choices for one Listen. System is always available. Edge and
 * ElevenLabs need a token; ElevenLabs also needs a configured voice id.
 */
export function listTtsChoices(input: {
  token: string;
  elevenLabsVoiceId: string;
}): TtsChoice[] {
  const choices: TtsChoice[] = [
    { ttsProvider: "system", edgeVoice: "elvira", elevenLabsVoiceId: "" },
  ];
  if (!input.token.trim()) return choices;

  for (const edgeVoice of EDGE_VOICES) {
    choices.push({
      ttsProvider: "edge",
      edgeVoice,
      elevenLabsVoiceId: "",
    });
  }

  const elevenId = input.elevenLabsVoiceId.trim();
  if (elevenId) {
    choices.push({
      ttsProvider: "elevenlabs",
      edgeVoice: "elvira",
      elevenLabsVoiceId: elevenId,
    });
  }
  return choices;
}

/** Pick one choice. `random` returns [0, 1) like Math.random. */
export function pickRandomTtsChoice(
  input: { token: string; elevenLabsVoiceId: string },
  random: () => number = Math.random,
): TtsChoice {
  const choices = listTtsChoices(input);
  const first = choices[0];
  if (first === undefined) {
    return {
      ttsProvider: "system",
      edgeVoice: "elvira",
      elevenLabsVoiceId: "",
    };
  }
  const index = Math.min(
    choices.length - 1,
    Math.max(0, Math.floor(random() * choices.length)),
  );
  return choices[index] ?? first;
}
