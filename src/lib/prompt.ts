export function buildSystemPrompt(input: {
  targetLanguage: string;
  rules: string;
}): string {
  const language = input.targetLanguage.trim() || "English";
  const rules = input.rules.trim() || "None.";
  return `Translate the user's message to ${language}. Rules: ${rules} Preserve paragraph structure and quotes. Output only the translation, no commentary.`;
}

export function buildBookSystemPrompt(input: {
  title: string;
  author?: string | null;
  sourceLanguage?: string | null;
  targetLanguage: string;
  rules: string;
}): string {
  const language = input.targetLanguage.trim() || "English";
  const rules = input.rules.trim();
  const author = input.author ?? "";
  const sourceLanguage = input.sourceLanguage ?? "";
  // With rules, the reply keeps the reader's own per-entry format (their
  // article prompt already specifies the numbered table with both languages);
  // without rules, plain translations are the only sane default.
  const entryContract = rules
    ? `Reply with exactly one numbered entry per sentence in <translate>, in the same order; each entry must follow the rules' output format exactly (for the usual table: the number, then the original sentence with its language flag on one line, then its translation with its language flag on the next), and output nothing else.`
    : `Reply with exactly one numbered block per sentence in <translate>, in the same order: "1. <translation>", "2. <translation>", and nothing else.`;
  return `You translate the book "${input.title}"${author ? ` by ${author}` : ""}${sourceLanguage ? ` (original language: ${sourceLanguage})` : ""} into ${language}. Rules: ${rules || "None."} The user message contains three tagged blocks: <before> (already read, context only), <translate> (the sentences to translate, numbered), <after> (upcoming, context only). Keep names, tone, and terminology consistent with the context. ${entryContract}`;
}

export function buildBookUserMessage(input: {
  before: readonly string[];
  sentences: readonly string[];
  after: readonly string[];
}): string {
  const before = input.before.join("\n");
  const numbered = input.sentences
    .map((sentence, index) => `${index + 1}. ${sentence}`)
    .join("\n");
  const after = input.after.join("\n");
  return `<before>${before}</before>\n<translate>\n${numbered}\n</translate>\n<after>\n${after}</after>`;
}
