export const DEFAULT_CHUNK_CHARS = 12_000;

export function chunkText(
  text: string,
  maxChars: number = DEFAULT_CHUNK_CHARS,
): string[] {
  const trimmed = text.trim();
  if (trimmed.length === 0) return [];

  const pieces: string[] = [];
  for (const paragraph of trimmed.split(/\n{2,}/)) {
    pieces.push(...splitToMax(paragraph, maxChars));
  }

  const chunks: string[] = [];
  let current = "";
  for (const piece of pieces) {
    const candidate = current ? `${current}\n\n${piece}` : piece;
    if (candidate.length <= maxChars) {
      current = candidate;
    } else {
      if (current) chunks.push(current);
      current = piece;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function splitToMax(paragraph: string, maxChars: number): string[] {
  if (paragraph.length <= maxChars) return [paragraph];
  const out: string[] = [];
  let current = "";
  for (const sentence of paragraph.split(/(?<=[.!?])\s+/)) {
    if (sentence.length > maxChars) {
      flushBuffer(out, current);
      current = "";
      pushHardSlices(out, sentence, maxChars);
      continue;
    }
    current = appendWithinMax(current, sentence, maxChars, out);
  }
  flushBuffer(out, current);
  return out;
}

function flushBuffer(out: string[], current: string): void {
  if (current) out.push(current);
}

function pushHardSlices(
  out: string[],
  sentence: string,
  maxChars: number,
): void {
  for (let i = 0; i < sentence.length; i += maxChars) {
    out.push(sentence.slice(i, i + maxChars));
  }
}

function appendWithinMax(
  current: string,
  sentence: string,
  maxChars: number,
  out: string[],
): string {
  const candidate = current ? `${current} ${sentence}` : sentence;
  if (candidate.length <= maxChars) return candidate;
  flushBuffer(out, current);
  return sentence;
}
