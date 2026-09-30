import { chunkText } from "./chunk";
import { buildSystemPrompt } from "./prompt";
import type { TranslateRequest } from "./types";

export interface TranslationSettings {
  targetLanguage: string;
  rules: string;
  model: string;
}

export interface TranslationProgress {
  translatedChunks: number;
  totalChunks: number;
  translation: string;
}

export class TranslationError extends Error {
  constructor(
    message: string,
    readonly translatedChunks: number,
    readonly totalChunks: number,
  ) {
    super(message);
    this.name = "TranslationError";
  }
}

export interface RunTranslationOptions {
  text: string;
  settings: TranslationSettings;
  translate: (request: TranslateRequest) => Promise<string>;
  existingTranslation?: string;
  translatedChunks?: number;
  totalChunks?: number;
  retries?: number;
  onProgress?: (progress: TranslationProgress) => Promise<void> | void;
}

export async function runTranslation(
  options: RunTranslationOptions,
): Promise<{ translation: string; totalChunks: number }> {
  const chunks = chunkText(options.text);
  if (chunks.length === 0) {
    return { translation: options.existingTranslation ?? "", totalChunks: 0 };
  }

  const totalChunks = options.totalChunks ?? chunks.length;
  const maxAttempts = (options.retries ?? 2) + 1;
  const system = buildSystemPrompt({
    targetLanguage: options.settings.targetLanguage,
    rules: options.settings.rules,
  });

  let translation = options.existingTranslation ?? "";
  let translatedChunks = options.translatedChunks ?? 0;

  for (let index = translatedChunks; index < chunks.length; index += 1) {
    let lastError: unknown = null;
    let done = false;
    for (let attempt = 1; attempt <= maxAttempts && !done; attempt += 1) {
      try {
        const output = (
          await options.translate({
            model: options.settings.model,
            system,
            text: chunks[index] ?? "",
          })
        ).trim();
        if (!output) throw new Error("empty translation");
        translation = translation ? `${translation}\n\n${output}` : output;
        translatedChunks = index + 1;
        done = true;
      } catch (error) {
        lastError = error;
      }
    }
    if (!done) {
      throw new TranslationError(
        lastError instanceof Error ? lastError.message : String(lastError),
        translatedChunks,
        totalChunks,
      );
    }
    // Progress persistence lives outside the retry loop: a failing callback
    // must not trigger a re-translation (which would duplicate the chunk).
    await options.onProgress?.({
      translatedChunks,
      totalChunks,
      translation,
    });
  }

  return { translation, totalChunks };
}
