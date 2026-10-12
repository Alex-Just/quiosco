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
  const rules = input.rules.trim() || "None.";
  const author = input.author ?? "";
  const sourceLanguage = input.sourceLanguage ?? "";
  return `You translate the book "${input.title}"${author ? ` by ${author}` : ""}${sourceLanguage ? ` (original language: ${sourceLanguage})` : ""} into ${language}. Rules: ${rules} The user message contains three tagged blocks: <before> (already read, context only), <translate> (the sentences to translate, numbered), <after> (upcoming, context only). Keep names, tone, and terminology consistent with the context. Reply with exactly one numbered block per sentence in <translate>, in the same order: "1. <translation>", "2. <translation>", and nothing else.`;
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
