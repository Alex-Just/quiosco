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

// Bilingual articles put a second language flag mid-paragraph. Split there so
// each language stanza is its own tappable fragment (even with no period).
const FLAG_STANZA_BREAK = /(?=[\u{1F1E6}-\u{1F1FF}]{2})/u;
const FLAG_AT_START = /^[\u{1F1E6}-\u{1F1FF}]{2}/u;

export function splitFlagStanzas(text: string): string[] {
  const parts = text
    .split(FLAG_STANZA_BREAK)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 2) return parts;
  const [prefix, first, ...rest] = parts;
  // Keep a leading index ("20") with the first flag stanza.
  if (
    prefix != null &&
    first != null &&
    !FLAG_AT_START.test(prefix) &&
    FLAG_AT_START.test(first)
  ) {
    return [`${prefix}\n${first}`, ...rest];
  }
  return parts;
}

/** First language block on a bilingual screen (the original stanza). */
export function firstFlagStanza(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  return splitFlagStanzas(trimmed)[0] ?? trimmed;
}

function splitPunctuationSentences(stanza: string): string[] {
  const sentences: string[] = [];
  let current = "";
  for (const part of stanza.split(SENTENCE_BREAK)) {
    current = current ? `${current} ${part}` : part;
    if (endsWithAbbreviation(current)) continue;
    sentences.push(current);
    current = "";
  }
  if (current) sentences.push(current);
  return sentences;
}

export function splitSentences(paragraph: string): string[] {
  const trimmed = paragraph.trim();
  if (!trimmed) return [];
  return splitFlagStanzas(trimmed).flatMap(splitPunctuationSentences);
}

// Paragraph numbers ("11", "1.") and flag emojis ("🇪🇸") glued to the front of
// a sentence are page furniture: the page renders the number as a dimmed
// n/total marker outside the tappable sentence, and the text that leaves the
// app (TTS and Copy) drops both markers. A sentence that is nothing but a
// marker is returned unchanged so nothing speaks an empty line.
const LIST_NUMBER = /^(\d{1,4})\s*[.)º°](?=\s|$)/;
// Bare index before a newline, or before spaces + a flag on the same line
// ("3 🇪🇸 …"). Do not match years glued to words ("2026 fue").
const STANDALONE_NUMBER = /^(\d{1,4})(?=\n|\s+[\u{1F1E6}-\u{1F1FF}]{2})/u;
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
  return { number: match[1] ?? null, text };
}
