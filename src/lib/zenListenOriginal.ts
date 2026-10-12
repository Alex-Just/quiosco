import { bodyParagraphs } from "./articleDisplayHelpers";
import {
  firstFlagStanza,
  splitSentences,
  stripSentenceMarkers,
} from "./sentences";

/** Prepare one paragraph for TTS: first stanza only, markers removed. */
export function speakableOriginalParagraph(text: string): string {
  const stanza = firstFlagStanza(text);
  if (!stanza) return "";
  return splitSentences(stanza)
    .map((sentence) => stripSentenceMarkers(sentence).trim())
    .filter((sentence) => sentence.length > 0)
    .join(" ");
}

/**
 * Original-language text for the current Zen page. Prefer the first stanza
 * of what is on screen — translation pages do not line up 1:1 with the
 * original body. Fall back to the original body only when the screen is empty.
 */
export function originalParagraphForZen(input: {
  originalBody: string;
  index: number;
  screenParagraph?: string;
}): string {
  const fromScreen = speakableOriginalParagraph(input.screenParagraph ?? "");
  if (fromScreen) return fromScreen;

  const originals = bodyParagraphs(input.originalBody);
  return speakableOriginalParagraph(originals[input.index] ?? "");
}
