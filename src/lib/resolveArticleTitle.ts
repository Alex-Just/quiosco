import { deriveTitle } from "./share";
import { isGarbageTitle } from "./titleQuality";

/**
 * Pick a readable article title. Shared Chrome reader-mode titles
 * ("Including link: chrome-distiller://…") and other garbage are skipped so
 * the cleaned body (via LLM or first meaningful line) can supply one.
 */
export async function resolveArticleTitle(input: {
  title: string;
  extractedTitle: string | null;
  body: string;
  url: string | null;
  guessWithLlm?: (body: string) => Promise<string | null>;
}): Promise<string> {
  const provided = input.title.trim();
  if (provided && !isGarbageTitle(provided)) return provided.slice(0, 200);

  const extracted = input.extractedTitle?.trim() ?? "";
  if (extracted && !isGarbageTitle(extracted)) return extracted.slice(0, 200);

  if (input.guessWithLlm) {
    const guessed = await input.guessWithLlm(input.body);
    const cleaned = guessed?.trim() ?? "";
    if (cleaned && !isGarbageTitle(cleaned)) return cleaned.slice(0, 200);
  }

  return deriveTitle({
    extractedTitle: null,
    sharedTitle: "",
    text: input.body,
    url: input.url,
  });
}
