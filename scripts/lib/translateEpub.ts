// Local EPUB translation core. Reuses the reader's sentence windowing, prompt,
// numbered-reply parser, cache key and bilingual display pairing, but replaces
// the Worker + Zen transport with one `opencode run` call per window.
import { spawn } from "node:child_process";
import {
  mkdir,
  readFile,
  rename,
  rmdir,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { BookSentenceUnit } from "../../src/lib/bookText";
import { nextWindow } from "../../src/lib/bookWindow";
import { parseNumberedTranslations } from "../../src/lib/numberedTranslations";
import { buildBookUserMessage } from "../../src/lib/prompt";
import {
  createSentenceKeyMemo,
  normalizeSentence,
  type SentenceKeyMemo,
} from "../../src/lib/sentenceKey";
import type { SentenceCacheEntry } from "../../src/lib/types";
import { pairSourceWithTranslation } from "../../src/lib/zenTranslationDisplay";

export const DEFAULT_TRANSLATION_MODEL = "opencode/deepseek-v4.1-flash-free";
export const DEFAULT_CACHE_PATH = join(
  process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"),
  "quiosco",
  "epub-translations.json",
);

const CACHE_VERSION = 1;
const MAX_ATTEMPTS = 3;
/** Cache writes are short; this only needs to cover another process's save. */
const LOCK_RETRY_MS = 50;
const LOCK_TIMEOUT_MS = 60_000;
const LOCK_STALE_MS = 5 * 60_000;

export interface ModelRef {
  providerID: string;
  id: string;
}

/** Validate the `provider/model` spelling `opencode run --model` expects. */
export function parseModelRef(value: string): ModelRef {
  const slash = value.indexOf("/");
  if (slash <= 0 || slash === value.length - 1) {
    throw new Error(`Invalid model "${value}": expected provider/model.`);
  }
  return {
    providerID: value.slice(0, slash),
    id: value.slice(slash + 1),
  };
}

/** Collect the assistant text from `opencode run --format json` JSONL. */
export function collectOpencodeText(stdout: string): string {
  const parts: string[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let event: unknown;
    try {
      event = JSON.parse(trimmed);
    } catch {
      throw new Error(
        `opencode returned non-JSON output: ${trimmed.slice(0, 200)}`,
      );
    }
    if (!isRecord(event)) continue;
    if (event.type === "error" || event.type === "session.error") {
      throw new Error(
        `opencode error: ${JSON.stringify(event.error ?? event).slice(0, 500)}`,
      );
    }
    const part = event.part;
    if (
      event.type === "text" &&
      isRecord(part) &&
      part.type === "text" &&
      typeof part.text === "string"
    ) {
      parts.push(part.text);
    }
  }

  const text = parts.join("\n").trim();
  if (!text) throw new Error("opencode returned no text");
  return text;
}

export interface OpencodeTranslatorOptions {
  model: string;
  binary?: string;
  cwd?: string;
  timeoutMs?: number;
}

/**
 * One translation call per window through the OpenCode app's local service.
 * The project agent keeps the call tool-free and single-step.
 */
export function createOpencodeTranslator(
  options: OpencodeTranslatorOptions,
): (prompt: string) => Promise<string> {
  const binary = options.binary ?? "opencode";
  const cwd = options.cwd ?? process.cwd();
  const timeout = options.timeoutMs ?? 3 * 60_000;

  return async (prompt) => {
    const result = await runOpencode(
      binary,
      [
        "run",
        "--agent",
        "translate-epub",
        "--model",
        options.model,
        "--format",
        "json",
        prompt,
      ],
      { cwd, timeout },
    );
    try {
      return collectOpencodeText(result.stdout);
    } catch (error) {
      const detail = result.stderr.trim();
      throw new Error(
        detail ? `${errorMessage(error)}\n${detail}` : errorMessage(error),
        { cause: error },
      );
    }
  };
}

function runOpencode(
  binary: string,
  args: readonly string[],
  options: { cwd: string; timeout: number },
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, [...args], {
      cwd: options.cwd,
      // `opencode run` waits for terminal input when both stdio pipes look
      // interactive. CI + NO_COLOR make its JSON mode fully non-interactive.
      env: { ...process.env, CI: "1", NO_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    };
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      const killTimer = setTimeout(() => child.kill("SIGKILL"), 5_000);
      killTimer.unref();
      fail(new Error(`opencode run timed out after ${options.timeout} ms`));
    }, options.timeout);

    if (child.stdout === null || child.stderr === null) {
      child.kill();
      fail(new Error("opencode run could not be started"));
      return;
    }
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr = `${stderr}${chunk}`.slice(-8_000);
    });
    child.on("error", fail);
    child.on("close", (code, signal) => {
      if (settled) return;
      if (code === 0) {
        settled = true;
        clearTimeout(timer);
        resolve({ stdout, stderr });
        return;
      }
      const detail = opencodeErrorDetail(stdout) ?? stderr.trim();
      fail(
        new Error(
          `opencode run exited with ${code ?? signal ?? "unknown status"}${
            detail ? `: ${detail}` : ""
          }`,
        ),
      );
    });
  });
}

export interface TranslationCache {
  get(key: string): SentenceCacheEntry | undefined;
  set(entry: SentenceCacheEntry): void;
  save(): Promise<void>;
}

/** Content-addressed cache persisted as one atomically replaced JSON file. */
export async function openTranslationCache(
  filePath: string,
): Promise<TranslationCache> {
  const document = await readCacheDocument(filePath);
  const entries = new Map(Object.entries(document.entries));
  const changedKeys = new Set<string>();

  return {
    get: (key) => entries.get(key),
    set: (entry) => {
      entries.set(entry.key, entry);
      changedKeys.add(entry.key);
    },
    save: async () => {
      await mkdir(dirname(filePath), { recursive: true });
      await withFileLock(filePath, async () => {
        // Another process may have translated since this cache was opened.
        // Merge its entries before replacing the file so neither run loses
        // work. The lock covers the read-merge-write sequence.
        const onDisk = await readCacheDocument(filePath);
        for (const [key, entry] of Object.entries(onDisk.entries)) {
          if (!changedKeys.has(key)) entries.set(key, entry);
        }
        const payload: CacheDocument = {
          version: CACHE_VERSION,
          entries: Object.fromEntries(entries),
        };
        const tempPath = `${filePath}.${process.pid}.tmp`;
        await writeFile(
          tempPath,
          `${JSON.stringify(payload, null, 2)}\n`,
          "utf8",
        );
        await rename(tempPath, filePath);
      });
    },
  };
}

async function withFileLock<T>(
  filePath: string,
  run: () => Promise<T>,
): Promise<T> {
  const lockPath = `${filePath}.lock`;
  const started = Date.now();

  for (;;) {
    try {
      await mkdir(lockPath);
      break;
    } catch (error) {
      if (!isErrnoException(error) || error.code !== "EEXIST") throw error;

      try {
        const info = await stat(lockPath);
        if (Date.now() - info.mtimeMs > LOCK_STALE_MS) {
          await rmdir(lockPath);
          continue;
        }
      } catch {
        // The lock vanished between mkdir and stat; retry immediately.
      }

      if (Date.now() - started > LOCK_TIMEOUT_MS) {
        throw new Error(`Timed out waiting for cache lock ${lockPath}.`);
      }
      await sleep(LOCK_RETRY_MS);
    }
  }

  try {
    return await run();
  } finally {
    await rmdir(lockPath).catch(() => undefined);
  }
}

export interface TranslationProgress {
  done: number;
  total: number;
  windows: number;
}

export interface TranslateUnitsArgs {
  units: readonly BookSentenceUnit[];
  system: string;
  targetLanguage: string;
  rules: string;
  model: string;
  cache: TranslationCache;
  translate: (prompt: string) => Promise<string>;
  maxWindows?: number;
  retryDelayMs?: number;
  onProgress?: (progress: TranslationProgress) => void;
}

export interface TranslateUnitsResult {
  translations: ReadonlyMap<number, string>;
  windows: number;
  complete: boolean;
}

/**
 * Translate every missing sentence unit, resuming from the verified cache and
 * persisting after each window. A partial model reply is accepted; the next
 * window starts at the first sentence still missing.
 */
export async function translateUnits(
  args: TranslateUnitsArgs,
): Promise<TranslateUnitsResult> {
  const keyMemo = createSentenceKeyMemo({
    targetLanguage: args.targetLanguage,
    rules: args.rules,
  });
  const rulesHashValue = await keyMemo.rulesHash();
  const translations = await readCachedTranslations({
    units: args.units,
    cache: args.cache,
    keyMemo,
    targetLanguage: args.targetLanguage,
    rulesHashValue,
  });
  const total = countUnits(args.units);
  const retryDelayMs = args.retryDelayMs ?? 500;
  let windows = 0;

  for (;;) {
    if (args.maxWindows !== undefined && windows >= args.maxWindows) break;
    const anchor = firstMissingUnit(args.units, translations);
    if (anchor === -1) break;

    const plan = nextWindow({
      units: args.units,
      anchor,
      cached: (index) =>
        args.units[index]?.skipped === true || translations.has(index),
    });
    if (plan === null) break;

    const indices: number[] = [];
    const sentences: string[] = [];
    for (let index = plan.start; index < plan.end; index += 1) {
      const unit = args.units[index];
      if (unit === undefined || unit.skipped || translations.has(index)) {
        continue;
      }
      indices.push(index);
      sentences.push(unit.text);
    }
    if (sentences.length === 0) {
      throw new Error("Could not plan a translation window.");
    }

    const prompt = `${args.system}\n\n${buildBookUserMessage({
      before: plan.contextBefore,
      sentences,
      after: plan.contextAfter,
    })}`;
    const parsed = await translateWindow({
      prompt,
      expected: sentences.length,
      translate: args.translate,
      retryDelayMs,
    });

    const now = Date.now();
    let accepted = 0;
    for (const [position, rawTranslation] of parsed) {
      const unitIndex = indices[position - 1];
      if (unitIndex === undefined) continue;
      const unit = args.units[unitIndex];
      if (unit === undefined) continue;

      const translation = pairSourceWithTranslation(unit.text, rawTranslation);
      translations.set(unitIndex, translation);
      args.cache.set({
        key: await keyMemo.keyFor(unit.text),
        source: unit.text,
        translation,
        targetLanguage: args.targetLanguage,
        rulesHash: rulesHashValue,
        model: args.model,
        createdAt: now,
      });
      accepted += 1;
    }
    if (accepted === 0) {
      throw new Error("The model reply accepted no sentences.");
    }

    await args.cache.save();
    windows += 1;
    args.onProgress?.({
      done: countTranslated(args.units, translations),
      total,
      windows,
    });
  }

  return {
    translations,
    windows,
    complete: firstMissingUnit(args.units, translations) === -1,
  };
}

async function translateWindow(args: {
  prompt: string;
  expected: number;
  translate: (prompt: string) => Promise<string>;
  retryDelayMs: number;
}): Promise<Map<number, string>> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const raw = await args.translate(args.prompt);
      const parsed = parseNumberedTranslations(raw, args.expected);
      if (parsed.size > 0) return parsed;
      lastError = new Error("the reply contained no numbered translations");
    } catch (error) {
      lastError = error;
    }

    if (attempt < MAX_ATTEMPTS) {
      await sleep(args.retryDelayMs * 2 ** (attempt - 1));
    }
  }

  const detail =
    lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(
    `Translation window failed after ${MAX_ATTEMPTS} attempts: ${detail}`,
    { cause: lastError },
  );
}

async function readCachedTranslations(args: {
  units: readonly BookSentenceUnit[];
  cache: TranslationCache;
  keyMemo: SentenceKeyMemo;
  targetLanguage: string;
  rulesHashValue: string;
}): Promise<Map<number, string>> {
  const translations = new Map<number, string>();

  for (let index = 0; index < args.units.length; index += 1) {
    const unit = args.units[index];
    if (unit === undefined || unit.skipped) continue;

    const key = await args.keyMemo.keyFor(unit.text);
    const entry = args.cache.get(key);
    if (
      entry !== undefined &&
      entry.translation.trim().length > 0 &&
      normalizeSentence(entry.source) === normalizeSentence(unit.text) &&
      entry.targetLanguage === args.targetLanguage &&
      entry.rulesHash === args.rulesHashValue
    ) {
      translations.set(index, entry.translation);
    }
  }

  return translations;
}

function firstMissingUnit(
  units: readonly BookSentenceUnit[],
  translations: ReadonlyMap<number, string>,
): number {
  for (let index = 0; index < units.length; index += 1) {
    const unit = units[index];
    if (unit !== undefined && !unit.skipped && !translations.has(index)) {
      return index;
    }
  }
  return -1;
}

function countUnits(units: readonly BookSentenceUnit[]): number {
  let total = 0;
  for (const unit of units) {
    if (!unit.skipped) total += 1;
  }
  return total;
}

function countTranslated(
  units: readonly BookSentenceUnit[],
  translations: ReadonlyMap<number, string>,
): number {
  let done = 0;
  for (let index = 0; index < units.length; index += 1) {
    const unit = units[index];
    if (unit !== undefined && !unit.skipped && translations.has(index)) {
      done += 1;
    }
  }
  return done;
}

interface CacheDocument {
  version: number;
  entries: Record<string, SentenceCacheEntry>;
}

async function readCacheDocument(filePath: string): Promise<CacheDocument> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") {
      return { version: CACHE_VERSION, entries: {} };
    }
    throw new Error(
      `Could not read cache ${filePath}: ${errorMessage(error)}`,
      {
        cause: error,
      },
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Cache ${filePath} is not valid JSON; delete it or pass --cache.`,
      { cause: error },
    );
  }
  if (!isCacheDocument(parsed)) {
    throw new Error(
      `Cache ${filePath} has an unsupported version or shape; delete it or pass --cache.`,
    );
  }
  return parsed;
}

function isCacheDocument(value: unknown): value is CacheDocument {
  if (
    !isRecord(value) ||
    value.version !== CACHE_VERSION ||
    !isRecord(value.entries)
  ) {
    return false;
  }
  return Object.entries(value.entries).every(
    ([key, entry]) => isSentenceCacheEntry(entry) && entry.key === key,
  );
}

function isSentenceCacheEntry(value: unknown): value is SentenceCacheEntry {
  if (!isRecord(value)) return false;
  return (
    typeof value.key === "string" &&
    typeof value.source === "string" &&
    typeof value.translation === "string" &&
    typeof value.targetLanguage === "string" &&
    typeof value.rulesHash === "string" &&
    typeof value.model === "string" &&
    typeof value.createdAt === "number"
  );
}

/** Provider/runtime error carried in a failed run's JSONL stdout. */
function opencodeErrorDetail(stdout: string): string | null {
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let event: unknown;
    try {
      event = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (
      isRecord(event) &&
      (event.type === "error" || event.type === "session.error")
    ) {
      return JSON.stringify(event.error ?? event).slice(0, 500);
    }
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
