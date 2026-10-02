import { isGarbageTitle } from "./titleQuality";

const TITLE_INPUT_CHARS = 4000;

export const TITLE_SYSTEM_PROMPT = `You extract the headline of a news article. You receive raw article text (it may start with page noise such as menus or cookie notices).

Return ONLY the headline as a single plain-text line:
- If the text contains a clear headline (a short standalone line, not a sentence), return it verbatim.
- Otherwise, write a concise headline-style title of 4-12 words summarizing the article, in the same language as the text. Never copy a full sentence.
- Never output a URL, a file path, or a line that contains a link.
- No quotes, no markdown, no commentary, no trailing period. Output the title line only.`;

export async function extractTitleWithLlm(
  text: string,
  model: string,
  translate: (request: {
    model: string;
    system: string;
    text: string;
  }) => Promise<string>,
): Promise<string | null> {
  const input = text.trim().slice(0, TITLE_INPUT_CHARS);
  if (input.length < 40) return null;
  try {
    const raw = await translate({
      model,
      system: TITLE_SYSTEM_PROMPT,
      text: input,
    });
    const line =
      raw
        .split("\n")
        .map((candidate) => candidate.trim())
        .find((candidate) => candidate.length > 0) ?? "";
    let cleaned = line
      .replace(/^["'«»“”]+/, "")
      .replace(/["'«»“”]+$/, "")
      .trim();
    cleaned = cleaned.replace(/^#{1,6}\s*/, "").trim();
    cleaned = cleaned.replace(/\.$/, "").trim();
    if (cleaned.length === 0 || isGarbageTitle(cleaned)) return null;
    return cleaned.slice(0, 200);
  } catch {
    return null;
  }
}
