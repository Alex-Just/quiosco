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
 * Original-language text for the current Zen page. Prefer the original body
 * paragraph; if that index is missing (translation split differs), fall back
 * to the first stanza of what is on screen.
 */
export function originalParagraphForZen(input: {
  originalBody: string;
  index: number;
  screenParagraph?: string;
}): string {
  const originals = bodyParagraphs(input.originalBody);
  const fromOriginal = originals[input.index];
  if (fromOriginal != null && fromOriginal.trim().length > 0) {
    return speakableOriginalParagraph(fromOriginal);
  }
  return speakableOriginalParagraph(input.screenParagraph ?? "");
}
