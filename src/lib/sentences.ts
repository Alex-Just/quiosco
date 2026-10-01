// Sentence splitter for tap-to-act on a single sentence. Splits on [.!?…]
// followed by whitespace, then re-joins segments that only ended on a common
// abbreviation or an initial, so "El Sr. García llegó." stays one sentence.
// A miss degrades to a slightly larger or smaller tappable fragment, never to
// broken rendering.
const SENTENCE_BREAK = /(?<=[.!?…])\s+/;

const ABBREVIATIONS = new Set([
  "sr",
  "sra",
  "srta",
  "d",
  "dña",
  "dr",
  "dra",
  "prof",
  "profa",
  "ud",
  "uds",
  "etc",
  "pág",
  "págs",
  "núm",
  "art",
  "arts",
  "eeuu",
  "aprox",
  "tel",
  "av",
  "excmo",
  "ilmo",
  "gral",
]);

function endsWithAbbreviation(sentence: string): boolean {
  const match = /([A-Za-zÁÉÍÓÚÜÑáéíóúüñ.]+)\.$/.exec(sentence);
  if (!match) return false;
  const token = match[1] ?? "";
  const normalized = token.toLowerCase().replaceAll(".", "");
  // Single letters are initials ("J. R. Tolkien"); known abbreviations are
  // joined from a small list. Everything else ends a sentence.
  return normalized.length === 1 || ABBREVIATIONS.has(normalized);
}

export function splitSentences(paragraph: string): string[] {
  const trimmed = paragraph.trim();
  if (!trimmed) return [];
  const sentences: string[] = [];
  let current = "";
  for (const part of trimmed.split(SENTENCE_BREAK)) {
    current = current ? `${current} ${part}` : part;
    if (endsWithAbbreviation(current)) continue;
    sentences.push(current);
    current = "";
  }
  if (current) sentences.push(current);
  return sentences;
}
