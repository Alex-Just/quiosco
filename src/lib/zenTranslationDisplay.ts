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
  if ((onlyText.split("\n")[0] ?? "").trim() === sourceText) return repaired;

  return `${withSourceFlag(sourceText)}\n${repaired}`;
}

/**
 * Sidecar import: the source and target language are known, so build one
 * canonical two-stanza block even when the model omitted flags. Complete
 * bilingual blocks keep their target stanza; source-only blocks stay source.
 */
export function pairBilingualTranslation(
  source: string,
  translation: string,
  targetFlag = "",
): string {
  const sourceText = source.trim();
  const repaired = repairFlagMarkers(translation).trim();
  if (!repaired) return sourceText;
  if (!sourceText) return repaired;

  const targetText = targetStanza(repaired, sourceText);
  if (!targetText) return withSourceFlag(sourceText);
  const targetLine =
    targetFlag && !startsWithFlag(targetText)
      ? `${targetFlag} ${targetText}`
      : targetText;
  return `${withSourceFlag(sourceText)}\n${targetLine}`;
}

function targetStanza(block: string, sourceText: string): string {
  const stanzas = splitFlagStanzas(block);
  if (stanzas.length >= 2) {
    // Keep the target stanza's own flag when present.
    return (stanzas[stanzas.length - 1] ?? "").trim();
  }

  const stanza = stanzas[0] ?? block;
  const stripped = stripSentenceMarkers(stanza).trim();
  const lines = stripped.split("\n");
  if ((lines[0] ?? "").trim() === sourceText) {
    return lines.slice(1).join("\n").trim();
  }
  // A target-only stanza may already carry its flag; preserve it.
  return startsWithFlag(stanza) ? stanza.trim() : stripped;
}
