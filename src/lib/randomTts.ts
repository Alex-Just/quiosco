import type { EdgeVoiceSetting, TtsProvider } from "./types";

/** One playable (provider, voice) pair for random TTS. */
export type TtsChoice = {
  ttsProvider: TtsProvider;
  edgeVoice: EdgeVoiceSetting;
  elevenLabsVoiceId: string;
};

/** Inputs that decide which TTS choices are available. */
export type TtsChoiceRequest = {
  token: string;
  elevenLabsVoiceId: string;
};

const EDGE_VOICES: readonly EdgeVoiceSetting[] = ["elvira", "alvaro"];

const SYSTEM_CHOICE: TtsChoice = {
  ttsProvider: "system",
  edgeVoice: "elvira",
  elevenLabsVoiceId: "",
};

/**
 * Playable TTS choices for one Listen. System is always available. Edge and
 * ElevenLabs need a token; ElevenLabs also needs a configured voice id.
 */
export function listTtsChoices(input: TtsChoiceRequest): TtsChoice[] {
  const choices: TtsChoice[] = [SYSTEM_CHOICE];
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

/** Stable identity of one playable voice for bag bookkeeping. */
function choiceKey(choice: TtsChoice): string {
  return `${choice.ttsProvider}|${choice.edgeVoice}|${choice.elevenLabsVoiceId}`;
}

/** Fisher-Yates copy; `random` returns [0, 1) like Math.random. */
function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.min(i, Math.max(0, Math.floor(random() * (i + 1))));
    const a = out[i];
    const b = out[j];
    if (a !== undefined && b !== undefined) {
      out[i] = b;
      out[j] = a;
    }
  }
  return out;
}

export type TtsPicker = {
  /** Deal the next (provider, voice) pair for this Listen. */
  pick(input: TtsChoiceRequest): TtsChoice;
};

/**
 * Deal voices from a shuffle bag: every available voice plays once before any
 * repeats, so no voice can dominate a session. The bag lives until the page
 * reloads; it rebuilds when the available voices change, and a reshuffle
 * never opens with the voice that just played. `random` returns [0, 1) like
 * Math.random.
 */
export function createTtsPicker(random?: () => number): TtsPicker {
  let signature: string | null = null;
  let bag: TtsChoice[] = [];
  let lastKey: string | null = null;
  return {
    pick(input: TtsChoiceRequest): TtsChoice {
      const choices = listTtsChoices(input);
      const nextSignature = JSON.stringify(choices.map(choiceKey));
      if (nextSignature !== signature) {
        signature = nextSignature;
        bag = [];
      }
      if (bag.length === 0) {
        bag = shuffled(choices, random ?? Math.random);
        const first = bag[0];
        const second = bag[1];
        if (
          first !== undefined &&
          second !== undefined &&
          choiceKey(first) === lastKey
        ) {
          bag[0] = second;
          bag[1] = first;
        }
      }
      const choice = bag.shift() ?? choices[0] ?? SYSTEM_CHOICE;
      lastKey = choiceKey(choice);
      return choice;
    },
  };
}

const sessionPicker = createTtsPicker();

/** Deal the next voice from the session's shuffle bag. */
export function pickNextTtsChoice(input: TtsChoiceRequest): TtsChoice {
  return sessionPicker.pick(input);
}
