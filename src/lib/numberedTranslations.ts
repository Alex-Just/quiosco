/** A numbered block opener with content: "1. Text" / "2) Text", any padding. */
const NUMBERED_LINE = /^\s*(\d{1,4})[.)]\s+(\S.*)$/;
/** A bare numbered opener (the rules' table): "1", "2.", "3) ". */
const BARE_NUMBER = /^\s*(\d{1,4})[.)]?\s*$/;

/**
 * Parse a model reply of numbered translations into a 1-based sentence index →
 * translation-block map. Accepts both inline blocks ("1. Uno") and the rules'
 * table form ("1" on its own line, then the block's lines). Only the strict
 * prefix of aligned openers is accepted: parsing stops at the first gap,
 * regression, out-of-range index, or empty block. Lines are always filed
 * under the opener the reply itself provides, so a reply that opens the next
 * number before finishing an entry can truncate or misplace that entry — the
 * numbering is the only alignment the reply gives — but the cache can never
 * extend past the last aligned entry, and every entry holds exactly what the
 * model wrote under its number. Continuation lines keep their line breaks, so
 * a block can hold both languages on separate lines.
 */
export function parseNumberedTranslations(
  raw: string,
  expected: number,
): Map<number, string> {
  const out = new Map<number, string>();
  let current: number | null = null;
  for (const line of raw.split(/\r?\n/)) {
    const inline = NUMBERED_LINE.exec(line);
    const bare = inline ? null : BARE_NUMBER.exec(line);
    const opener = inline ?? bare;
    if (opener) {
      const index = Number(opener[1]);
      if (index !== out.size + 1 || index > expected) {
        // A stray marker before the first block is preamble; inside the
        // reply a mismatch ends the trustworthy prefix.
        if (!inline && current === null) continue;
        break;
      }
      // An opener arriving while the previous block still has no text means
      // that block was empty: the prefix ends there.
      if (current !== null && !(out.get(current) ?? "").length) break;
      current = index;
      out.set(index, inline ? (inline[2]?.trim() ?? "") : "");
      continue;
    }
    if (!line.trim()) {
      // A blank line while the final expected block is open ends the
      // reply; anything after it is trailing commentary.
      if (current === expected) break;
      continue;
    }
    if (current !== null) {
      const previous = out.get(current) ?? "";
      out.set(current, previous ? `${previous}\n${line.trim()}` : line.trim());
    }
  }
  // A trailing block with no text is missing, not a translation.
  if (current !== null && !(out.get(current) ?? "").length) out.delete(current);
  return out;
}
