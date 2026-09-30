export function buildSystemPrompt(input: {
  targetLanguage: string;
  rules: string;
}): string {
  const language = input.targetLanguage.trim() || "English";
  const rules = input.rules.trim() || "None.";
  return `Translate the user's message to ${language}. Rules: ${rules} Preserve paragraph structure and quotes. Output only the translation, no commentary.`;
}
