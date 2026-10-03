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

// Paragraph numbers ("11", "1.") and flag emojis ("🇪🇸") glued to the front of
// a sentence are page furniture: the page renders the number as a dimmed
// n/total marker outside the tappable sentence, and the text that leaves the
// app (TTS and Copy) drops both markers. A sentence that is nothing but a
// marker is returned unchanged so nothing speaks an empty line.
const LIST_NUMBER = /^(\d{1,4})\s*[.)º°](?=\s|$)/;
const STANDALONE_NUMBER = /^(\d{1,4})(?=\n)/;
const LEADING_FLAG = /^[\u{1F1E6}-\u{1F1FF}]{2}\s*/u;

export interface LeadingMarkers {
  /** The paragraph/list number without its punctuation ("11", "1"), if any. */
  number: string | null;
  /** The sentence with its leading number and flag markers removed. */
  text: string;
}

export function splitLeadingMarkers(sentence: string): LeadingMarkers {
  let number: string | null = null;
  let text = sentence;
  for (let pass = 0; pass < 4; pass += 1) {
    const trimmed = text.replace(/^\s+/, "");
    const match = LIST_NUMBER.exec(trimmed) ?? STANDALONE_NUMBER.exec(trimmed);
    let next: string;
    if (match) {
      if (number === null) number = match[1] ?? null;
      next = trimmed.slice(match[0].length).replace(/^\s+/, "");
    } else {
      next = trimmed.replace(LEADING_FLAG, "").replace(/^\s+/, "");
    }
    if (next === text || next === "") break;
    text = next;
  }
  return { number, text: text || sentence };
}

export function stripSentenceMarkers(sentence: string): string {
  return splitLeadingMarkers(sentence).text;
}

// Display-only variant: strips just the number marker (and the whitespace
// directly after it) so the page keeps the article's own flags, quotes and
// line breaks while the number becomes a dimmed n/total counter.
export function splitLeadingNumber(sentence: string): LeadingMarkers {
  const trimmed = sentence.replace(/^\s+/, "");
  const match = LIST_NUMBER.exec(trimmed) ?? STANDALONE_NUMBER.exec(trimmed);
  if (!match) return { number: null, text: sentence };
  const text = trimmed.slice(match[0].length).replace(/^\s+/, "");
  return { number: match[1] ?? null, text: text.length > 0 ? text : sentence };
}
