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
  translate: (
    request: TranslateRequest,
    onDelta?: (partial: string) => void,
  ) => Promise<string>;
  existingTranslation?: string;
  translatedChunks?: number;
  totalChunks?: number;
  retries?: number;
  signal?: AbortSignal;
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
    if (options.signal?.aborted) throw new Error("translation cancelled");
    let lastError: unknown = null;
    let done = false;
    for (let attempt = 1; attempt <= maxAttempts && !done; attempt += 1) {
      try {
        let lastPartialEmit = 0;
        let partialChain: Promise<void> = Promise.resolve();
        const output = (
          await options.translate(
            {
              model: options.settings.model,
              system,
              text: chunks[index] ?? "",
            },
            (partial) => {
              // Stream partials into the persisted translation so the reader
              // sees text grow, throttled to avoid hammering storage.
              const now = Date.now();
              if (now - lastPartialEmit < 600) return;
              lastPartialEmit = now;
              const preview = translation
                ? `${translation}\n\n${partial}`
                : partial;
              partialChain = partialChain
                .then(() =>
                  options.onProgress?.({
                    translatedChunks: index,
                    totalChunks,
                    translation: preview,
                  }),
                )
                .catch(() => undefined);
            },
          )
        ).trim();
        await partialChain;
        if (!output) throw new Error("empty translation");
        translation = translation ? `${translation}\n\n${output}` : output;
        translatedChunks = index + 1;
        done = true;
      } catch (error) {
        lastError = error;
        if (options.signal?.aborted) break;
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
