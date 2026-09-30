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
      if (current) {
        out.push(current);
        current = "";
      }
      for (let i = 0; i < sentence.length; i += maxChars) {
        out.push(sentence.slice(i, i + maxChars));
      }
      continue;
    }
    const candidate = current ? `${current} ${sentence}` : sentence;
    if (candidate.length <= maxChars) {
      current = candidate;
    } else {
      out.push(current);
      current = sentence;
    }
  }
  if (current) out.push(current);
  return out;
}
