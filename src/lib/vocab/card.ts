// One dictionary lookup from CrossPoint, plus the sentence taken from
// the chapter HTML at the stored source offset, ready to send to Anki.

export const MAX_WORD_CHARS = 160;
export const MAX_TEXT_CHARS = 512;
export const MAX_CONTEXT_CHARS = 4_000;
export const MAX_DEFINITION_CHARS = 4_000;
export const MAX_PAGE = 100_000;
export const MAX_SPINE = 10_000;
export const MAX_SOURCE_OFFSET = Number.MAX_SAFE_INTEGER;

const FIELD_SEPARATOR = "\u001f";
const TAG = /<[^>]+>/g;
const BREAK = /<br\s*\/?>/gi;
const NUMBERED_SENSE = /^(\d+)\s*(.*)$/;
const PRONUNCIATION = /\[(.+?)\]/;

export interface VocabCard {
  id: string;
  word: string;
  headword: string;
  context: string;
  definition: string;
  book: string;
  author: string;
  chapter: string;
  page: number;
  spine: number;
  startOffset: number;
}

export interface AnkiFields {
  Word: string;
  "Part of Speech": string;
  Transcription: string;
  Translation: string;
  Context: string;
  Additional: string;
}

export type LookupResult =
  | { ok: true; card: VocabCard }
  | { ok: false; word: string; reason: string };

export function bodyText(html: string): string {
  return html.replace(TAG, "");
}

export function cardId(card: {
  book: string;
  spine: number;
  startOffset: number;
  word: string;
}): string {
  return [
    card.book,
    String(card.spine),
    String(card.startOffset),
    card.word,
  ].join(FIELD_SEPARATOR);
}

/** The paragraph whose visible text contains this body codepoint offset. */
export function paragraphAtOffset(
  chapterHtml: string,
  startOffset: number,
): string | null {
  const body =
    chapterHtml.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? chapterHtml;
  const pattern = /<p\b[^>]*>[\s\S]*?<\/p>/gi;
  for (const match of body.matchAll(pattern)) {
    const start = match.index ?? 0;
    const prefixLength = bodyText(body.slice(0, start)).length;
    const plain = bodyText(match[0]);
    if (
      startOffset >= prefixLength &&
      startOffset < prefixLength + plain.length
    ) {
      return bodyText(match[0].replace(BREAK, "\n")).trim();
    }
  }
  return null;
}

export function parseVocabulary(text: string): unknown[] {
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as unknown);
}

export function ankiFields(card: VocabCard): AnkiFields {
  const definition = card.definition.trim();
  const [spanish = "", russian = ""] = card.context.split(/\n{2,}/);
  const sense = firstSense(definition);
  const place = `${card.book} — ${card.chapter}, p. ${card.page}.`;
  return {
    Word: card.word,
    "Part of Speech": firstLine(definition),
    Transcription: definition.match(PRONUNCIATION)?.[1] ?? "",
    Translation: russian.trim(),
    Context: spanish.trim(),
    Additional: sense.length > 0 ? `${place} ${sense}` : place,
  };
}

export function assembleCard(
  fields: Record<string, unknown>,
  context: string | null,
): LookupResult {
  const word = clean(fields.word, MAX_WORD_CHARS);
  const spine = integer(fields.spine, 0, MAX_SPINE);
  const startOffset = integer(fields.start_offset, 0, MAX_SOURCE_OFFSET);
  if (!word || spine === null || startOffset === null) {
    return { ok: false, word: word ?? "", reason: "invalid-line" };
  }
  if (!context?.includes(word)) {
    return { ok: false, word, reason: "missing-context" };
  }
  const card: VocabCard = {
    id: "",
    word,
    headword: clean(fields.headword, MAX_WORD_CHARS) ?? word,
    context: context.slice(0, MAX_CONTEXT_CHARS),
    definition: (typeof fields.definition === "string" ? fields.definition : "")
      .trim()
      .slice(0, MAX_DEFINITION_CHARS),
    book: clean(fields.title, MAX_TEXT_CHARS) ?? "",
    author: clean(fields.author, MAX_TEXT_CHARS) ?? "",
    chapter: clean(fields.chapter, MAX_TEXT_CHARS) ?? "",
    page: integer(fields.page, 0, MAX_PAGE) ?? 0,
    spine,
    startOffset,
  };
  if (card.book.length === 0) {
    return { ok: false, word, reason: "invalid-line" };
  }
  card.id = cardId(card);
  return { ok: true, card };
}

function clean(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > max) return null;
  return trimmed;
}

function integer(value: unknown, min: number, max: number): number | null {
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  if (value < min || value > max) return null;
  return value;
}

function firstLine(text: string): string {
  const line = text.split("\n").find((item) => item.trim().length > 0);
  return line?.trim() ?? "";
}

function firstSense(definition: string): string {
  for (const line of definition.split("\n")) {
    const match = line.trim().match(NUMBERED_SENSE);
    if (match?.[2]) return match[2].trim();
  }
  return "";
}
