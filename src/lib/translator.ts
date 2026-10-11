import { chunkText } from "./chunk";
import { buildSystemPrompt } from "./prompt";
import type { TranslateRequest } from "./types";

/** Min gap between persisted stream partials (keeps IndexedDB writes light). */
export const PARTIAL_PROGRESS_MIN_INTERVAL_MS = 600;

export interface TranslationSettings {
  targetLanguage: string;
  rules: string;
  model: string;
}

export interface TranslationProgress {
  translatedChunks: number;
  totalChunks: number;
  translation: string;
  /** In-flight text of the chunk being translated; cleared when it lands. */
  partial?: string;
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
  const system = buildSystemPrompt({
    targetLanguage: options.settings.targetLanguage,
    rules: options.settings.rules,
  });

  let translation = options.existingTranslation ?? "";
  let translatedChunks = options.translatedChunks ?? 0;

  for (let index = translatedChunks; index < chunks.length; index += 1) {
    if (options.signal?.aborted) throw new Error("translation cancelled");
    const output = await translateChunkWithRetries({
      options,
      system,
      chunk: chunks[index] ?? "",
      index,
      translation,
      totalChunks,
    });
    translation = translation ? `${translation}\n\n${output}` : output;
    translatedChunks = index + 1;
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

async function translateChunkWithRetries(args: {
  options: RunTranslationOptions;
  system: string;
  chunk: string;
  index: number;
  translation: string;
  totalChunks: number;
}): Promise<string> {
  const maxAttempts = (args.options.retries ?? 2) + 1;
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await translateChunkOnce(args);
    } catch (error) {
      lastError = error;
      if (args.options.signal?.aborted) break;
    }
  }
  throw new TranslationError(
    lastError instanceof Error ? lastError.message : String(lastError),
    args.index,
    args.totalChunks,
  );
}

async function translateChunkOnce(args: {
  options: RunTranslationOptions;
  system: string;
  chunk: string;
  index: number;
  translation: string;
  totalChunks: number;
}): Promise<string> {
  let lastPartialEmit = 0;
  let partialChain: Promise<void> = Promise.resolve();
  const output = (
    await args.options.translate(
      {
        model: args.options.settings.model,
        system: args.system,
        text: args.chunk,
      },
      (partial) => {
        partialChain = partialChain
          .then(() =>
            emitPartialProgress(args, partial, lastPartialEmit, (now) => {
              lastPartialEmit = now;
            }),
          )
          .catch(() => undefined);
      },
    )
  ).trim();
  await partialChain;
  if (!output) throw new Error("empty translation");
  return output;
}

async function emitPartialProgress(
  args: {
    options: RunTranslationOptions;
    index: number;
    translation: string;
    totalChunks: number;
  },
  partial: string,
  lastPartialEmit: number,
  setLastEmit: (now: number) => void,
): Promise<void> {
  // Stream partials in a separate field so the reader sees text grow,
  // throttled to avoid hammering storage. Keeping them out of `translation`
  // means a resume after a cancel/crash never re-appends a partial chunk.
  const now = Date.now();
  if (now - lastPartialEmit < PARTIAL_PROGRESS_MIN_INTERVAL_MS) return;
  setLastEmit(now);
  await args.options.onProgress?.({
    translatedChunks: args.index,
    totalChunks: args.totalChunks,
    translation: args.translation,
    partial,
  });
}
