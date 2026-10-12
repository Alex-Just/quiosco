/** A numbered block opener: "1. Text" / "2) Text", with any padding. */
const NUMBERED_LINE = /^\s*(\d{1,4})[.)]\s+(\S.*)$/;
/** A numbered marker with nothing after it: "2." or "2) ". */
const EMPTY_BLOCK = /^\s*\d{1,4}[.)]\s*$/;

/**
 * Parse a model reply of numbered translations ("1. Uno\n2. Dos…") into a
 * 1-based sentence index → translation map. Only the strict prefix 1..k is
 * accepted: parsing stops at the first gap, regression, out-of-range index,
 * or empty block, so a misaligned reply can never be cached past its last
 * trustworthy sentence.
 */
export function parseNumberedTranslations(
  raw: string,
  expected: number,
): Map<number, string> {
  const out = new Map<number, string>();
  let current: number | null = null;
  for (const line of raw.split(/\r?\n/)) {
    const match = NUMBERED_LINE.exec(line);
    if (match) {
      const index = Number(match[1]);
      if (index !== out.size + 1 || index > expected) break;
      current = index;
      out.set(index, match[2]?.trim() ?? "");
      continue;
    }
    if (!line.trim()) {
      // A blank line while the final expected block is open ends the
      // reply; anything after it is trailing commentary.
      if (current === expected) break;
      continue;
    }
    if (EMPTY_BLOCK.test(line)) {
      // Inside the reply an empty block means missing text, so stop;
      // before the first block it is just preamble.
      if (current !== null) break;
      continue;
    }
    if (current !== null) {
      const previous = out.get(current) ?? "";
      out.set(current, `${previous} ${line.trim()}`);
    }
  }
  return out;
}
