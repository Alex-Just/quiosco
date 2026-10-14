import { repairFlagMarkers, startsWithFlag } from "./flagLines";
import { splitFlagStanzas, stripSentenceMarkers } from "./sentences";

/** Spanish flag: regional E + S. Restores a missing original stanza. */
const FLAG_SPANISH = "\u{1F1EA}\u{1F1F8}";

function withSourceFlag(source: string): string {
  const trimmed = source.trim();
  if (!trimmed) return "";
  if (startsWithFlag(trimmed)) return trimmed;
  return `${FLAG_SPANISH} ${trimmed}`;
}

/**
 * Zen bilingual screen text for one book sentence unit.
 *
 * The model sometimes caches a translation-only block (target flag line, no
 * original). The source unit is known, so put it back on screen. Complete
 * bilingual entries and original-only stubs are left alone.
 */
export function pairSourceWithTranslation(
  source: string,
  translation: string,
): string {
  const sourceText = source.trim();
  const repaired = repairFlagMarkers(translation).trim();
  if (!repaired) return sourceText;
  if (!sourceText) return repaired;

  const stanzas = splitFlagStanzas(repaired);
  if (stanzas.length >= 2) return repaired;

  // Flagless replies are the no-rules contract ("1. <translation>"); leave
  // them alone. Only bilingual table entries omit the original flag line.
  const flagged =
    startsWithFlag(repaired) ||
    stanzas.some((stanza) => startsWithFlag(stanza));
  if (!flagged) return repaired;

  const onlyText = stripSentenceMarkers(stanzas[0] ?? repaired).trim();
  if (onlyText === sourceText) return repaired;

  return `${withSourceFlag(sourceText)}\n${repaired}`;
}
