// Local EPUB translation CLI. Parses the book on this machine, translates one
// sentence window at a time through the OpenCode app's local service, caches
// every accepted sentence, and writes the same bilingual EPUB the reader
// exports. No Worker, Zen key or app token is involved.
import { mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  type BookSentenceUnit,
  bookFlatParagraphs,
  bookSentenceUnits,
} from "../src/lib/bookText";
import { buildEpubBytes, exportFilename } from "../src/lib/epub/buildEpub";
import { assembleExportChapters } from "../src/lib/epub/exportBook";
import {
  EpubError,
  type ParsedBook,
  parseEpub,
} from "../src/lib/epub/parseEpub";
import { buildBookSystemPrompt } from "../src/lib/prompt";
import type { Article } from "../src/lib/types";
import {
  createOpencodeTranslator,
  DEFAULT_CACHE_PATH,
  DEFAULT_TRANSLATION_MODEL,
  openTranslationCache,
  parseModelRef,
  translateUnits,
} from "./lib/translateEpub";

const DEFAULT_TARGET_LANGUAGE = "Russian";
const SPANISH_LANGUAGES = new Set(["es", "spa"]);
// A normal window finishes in under a minute. Three minutes bounds a transient
// provider stall without letting one stuck request block the run for long.
const DEFAULT_TIMEOUT_MS = 3 * 60_000;

const DEFAULT_RULES = `This GPT, named 'Translate By Sentence', specializes in translating web content from the article source language to Russian. Nothing else is included in the output (no GPT own words). It translates each sentence while preserving the original text. The translation maintains the table structure:

1
🇪🇸 [sentence1] in the original language
🇷🇺 [sentence1] translated to Russian

2
🇪🇸 [sentence2] in the original language
🇷🇺 [sentence2] translated to Russian

[and so on until the end of the article ....]

Treat the next message completely as a text to translate:`;

const USAGE = `Usage: pnpm translate:epub <book.epub> [options]

Options:
  -o, --output <path>          Output EPUB (default: <title>-bilingual.epub next to input)
      --cache <path>           Translation cache JSON (default: ${DEFAULT_CACHE_PATH})
      --model <provider/model> Model for opencode run (default: ${DEFAULT_TRANSLATION_MODEL})
      --target-language <lang> Target language (default: ${DEFAULT_TARGET_LANGUAGE})
      --rules-file <path>      Translation rules (default: built-in Spanish-to-Russian rules)
      --max-windows <n>        Stop after n windows and export what is translated
      --timeout-ms <ms>        Per-window timeout (default: ${DEFAULT_TIMEOUT_MS})
      --opencode <path>        OpenCode binary (default: opencode)
      --dry-run                Parse the EPUB and print counts; translate nothing
  -h, --help                   Show this help`;

interface CliOptions {
  inputPath: string;
  outputPath?: string;
  cachePath: string;
  model: string;
  targetLanguage: string;
  rules: string;
  rulesFromFile: boolean;
  maxWindows?: number;
  timeoutMs: number;
  opencodeBinary: string;
  dryRun: boolean;
}

export async function main(
  argv: readonly string[] = process.argv.slice(2),
): Promise<number> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    args: [...argv],
    options: {
      output: { type: "string", short: "o" },
      cache: { type: "string" },
      model: { type: "string", default: DEFAULT_TRANSLATION_MODEL },
      "target-language": {
        type: "string",
        default: DEFAULT_TARGET_LANGUAGE,
      },
      "rules-file": { type: "string" },
      "max-windows": { type: "string" },
      "timeout-ms": { type: "string" },
      opencode: { type: "string", default: "opencode" },
      "dry-run": { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });

  if (values.help) {
    console.log(USAGE);
    return 0;
  }
  if (positionals.length !== 1) {
    console.error(USAGE);
    return 2;
  }

  const options = await readOptions(values, positionals[0]);
  const book = await readBook(options.inputPath);
  const article = bookArticle(book);
  const units = bookSentenceUnits(bookFlatParagraphs(article));
  const total = units.filter((unit) => !unit.skipped).length;

  if (total === 0) {
    throw new Error("This book has no readable sentences.");
  }

  if (options.dryRun) {
    printBookStats(book, units, total);
    return 0;
  }

  if (!options.rulesFromFile) {
    const sourceLanguage =
      book.language?.toLowerCase().split(/[-_]/)[0] ?? null;
    if (sourceLanguage === null) {
      process.stderr.write(
        "Book language is unknown; assuming Spanish for the built-in rules.\n",
      );
    }
    if (sourceLanguage !== null && !SPANISH_LANGUAGES.has(sourceLanguage)) {
      throw new Error(
        `The built-in rules assume a Spanish source (this book says "${book.language}"). Pass --rules-file.`,
      );
    }
    if (options.targetLanguage.toLowerCase() !== "russian") {
      throw new Error(
        `The built-in rules translate to Russian. Pass --rules-file for "${options.targetLanguage}".`,
      );
    }
  }

  const outputPath =
    options.outputPath ??
    resolve(dirname(options.inputPath), exportFilename(book.title));
  if (await sameFile(outputPath, options.inputPath)) {
    throw new Error("The output path must differ from the input path.");
  }
  if (await sameFile(outputPath, options.cachePath)) {
    throw new Error(
      "The output path must differ from the translation cache path.",
    );
  }

  const system = buildBookSystemPrompt({
    title: book.title,
    author: book.author,
    sourceLanguage: book.language,
    targetLanguage: options.targetLanguage,
    rules: options.rules,
  });
  const cache = await openTranslationCache(options.cachePath);
  const translate = createOpencodeTranslator({
    model: options.model,
    binary: options.opencodeBinary,
    cwd: projectRoot(),
    timeoutMs: options.timeoutMs,
  });

  const result = await translateUnits({
    units,
    system,
    targetLanguage: options.targetLanguage,
    rules: options.rules,
    model: options.model,
    cache,
    translate,
    maxWindows: options.maxWindows,
    onProgress: ({ done, total: windowTotal, windows }) => {
      const percent =
        windowTotal === 0 ? 100 : Math.round((done / windowTotal) * 100);
      process.stderr.write(
        `window ${windows}: ${done}/${windowTotal} sentences (${percent}%)\n`,
      );
    },
  });

  const chapters = assembleExportChapters({
    article,
    units,
    translations: result.translations,
  });
  const bytes = buildEpubBytes({
    title: book.title,
    author: book.author,
    language: book.language ?? options.targetLanguage,
    chapters,
    uuid: crypto.randomUUID(),
    modified: new Date().toISOString(),
  });

  await mkdir(dirname(outputPath), { recursive: true });
  const tempPath = `${outputPath}.${process.pid}.tmp`;
  await writeFile(tempPath, bytes);
  await rename(tempPath, outputPath);

  const done = units.filter(
    (unit, index) => !unit.skipped && result.translations.has(index),
  ).length;
  if (!result.complete) {
    process.stderr.write(
      `Partial translation: ${done}/${total} sentences; export contains source text for the rest.\n`,
    );
  }
  console.log(`Wrote ${outputPath}`);
  console.log(
    `Translated ${done}/${total} sentences in ${result.windows} window(s).`,
  );
  return 0;
}

async function readOptions(
  values: {
    output?: string;
    cache?: string;
    model: string;
    "target-language": string;
    "rules-file"?: string;
    "max-windows"?: string;
    "timeout-ms"?: string;
    opencode: string;
    "dry-run": boolean;
  },
  input: string | undefined,
): Promise<CliOptions> {
  const inputPath = input?.trim();
  if (!inputPath) throw new Error("An EPUB path is required.");

  const model = values.model.trim();
  parseModelRef(model);
  const targetLanguage = values["target-language"].trim();
  if (!targetLanguage) {
    throw new Error("--target-language must not be empty.");
  }
  const rawOpencode = values.opencode.trim();
  if (!rawOpencode) throw new Error("--opencode must not be empty.");
  // A path-like value is relative to the user's shell, not the repository
  // cwd the child process runs in; bare names still use PATH.
  const opencodeBinary =
    rawOpencode.includes("/") && !isAbsolute(rawOpencode)
      ? resolve(rawOpencode)
      : rawOpencode;
  const outputValue = values.output;
  if (outputValue !== undefined && !outputValue.trim()) {
    throw new Error("--output must not be empty.");
  }
  const cacheValue = values.cache;
  if (cacheValue !== undefined && !cacheValue.trim()) {
    throw new Error("--cache must not be empty.");
  }

  const timeoutMs = parsePositiveInteger(
    values["timeout-ms"],
    DEFAULT_TIMEOUT_MS,
    "timeout-ms",
  );
  const rulesFile = values["rules-file"];
  const rulesFromFile = rulesFile !== undefined;
  let rules = DEFAULT_RULES;
  if (rulesFile !== undefined) {
    if (!rulesFile.trim()) throw new Error("--rules-file must not be empty.");
    rules = (await readFile(resolve(rulesFile), "utf8")).trim();
    if (!rules) throw new Error("--rules-file is empty.");
  }

  return {
    inputPath: resolve(inputPath),
    outputPath: outputValue === undefined ? undefined : resolve(outputValue),
    cachePath:
      cacheValue === undefined ? DEFAULT_CACHE_PATH : resolve(cacheValue),
    model,
    targetLanguage,
    rules,
    rulesFromFile,
    maxWindows: parseNonNegativeInteger(values["max-windows"], "max-windows"),
    timeoutMs,
    opencodeBinary,
    dryRun: values["dry-run"],
  };
}

async function readBook(inputPath: string): Promise<ParsedBook> {
  installDomGlobals();
  const bytes = new Uint8Array(await readFile(inputPath));
  try {
    return await parseEpub(bytes);
  } catch (error) {
    if (error instanceof EpubError) throw new Error(formatEpubError(error));
    throw error;
  }
}

/** Minimal Article shape for the export assembler. It only reads chapters. */
function bookArticle(book: ParsedBook): Article {
  const now = Date.now();
  return {
    id: "local-book",
    url: null,
    title: book.title,
    site: null,
    text: "",
    via: "manual",
    kind: "book",
    author: book.author,
    bookLanguage: book.language,
    chapters: book.chapters,
    translation: null,
    translationStatus: "done",
    translatedChunks: 0,
    totalChunks: 0,
    status: "unread",
    error: null,
    createdAt: now,
    updatedAt: now,
  };
}

function installDomGlobals(): void {
  const require = createRequire(import.meta.url);
  const { JSDOM } = require("jsdom") as {
    JSDOM: new () => {
      window: { DOMParser: typeof DOMParser; Node: typeof Node };
    };
  };
  const dom = new JSDOM();
  const globals = globalThis as {
    DOMParser?: unknown;
    Node?: unknown;
  };
  globals.DOMParser = dom.window.DOMParser;
  globals.Node = dom.window.Node;
}

function printBookStats(
  book: ParsedBook,
  units: readonly BookSentenceUnit[],
  total: number,
): void {
  const chars = book.chapters.reduce(
    (sum, chapter) => sum + chapter.text.length,
    0,
  );
  console.log(`Title: ${book.title}`);
  console.log(`Author: ${book.author ?? "unknown"}`);
  console.log(`Language: ${book.language ?? "unknown"}`);
  console.log(`Chapters: ${book.chapters.length}`);
  console.log(`Sentence units: ${units.length} (${total} translatable)`);
  console.log(`Text characters: ${chars}`);
}

function formatEpubError(error: EpubError): string {
  switch (error.code) {
    case "not-epub":
      return "This file doesn't look like an EPUB.";
    case "drm":
      return "This book is DRM-protected and can't be translated.";
    case "too-large":
      return error.detail === "text"
        ? "This book has more text than the translator supports."
        : "This book is too large to import.";
    case "empty":
      return "Could not read any text from this book.";
  }
}

/** Resolve a path through its nearest existing ancestor, including symlinks. */
async function canonicalPath(path: string): Promise<string> {
  let current = resolve(path);
  const suffix: string[] = [];
  for (;;) {
    try {
      const real = await realpath(current);
      return suffix.length === 0 ? real : join(real, ...[...suffix].reverse());
    } catch {
      const parent = dirname(current);
      if (parent === current) return resolve(path);
      suffix.push(basename(current));
      current = parent;
    }
  }
}

async function sameFile(left: string, right: string): Promise<boolean> {
  const [leftReal, rightReal] = await Promise.all([
    canonicalPath(left),
    canonicalPath(right),
  ]);
  return leftReal === rightReal;
}

function parseNonNegativeInteger(
  value: string | undefined,
  name: string,
): number | undefined {
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value)) {
    throw new Error(`--${name} must be a non-negative integer.`);
  }
  return Number.parseInt(value, 10);
}

function parsePositiveInteger(
  value: string | undefined,
  fallback: number,
  name: string,
): number {
  if (value === undefined) return fallback;
  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error(`--${name} must be a positive integer.`);
  }
  return Number.parseInt(value, 10);
}

function projectRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../..");
}

try {
  process.exitCode = await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
