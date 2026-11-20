import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { cardsFromBook, epubIdentity } from "../src/lib/vocab/book";
import type { LookupResult, VocabCard } from "../src/lib/vocab/card";
import {
  cardsFromCatalog,
  groupLookups,
  lookupWord,
} from "../src/lib/vocab/library";
import {
  DEFAULT_READER,
  parseReaderListing,
  READER_VOCAB_PATH,
  type ReaderEpubFile,
  readerDownloadUrl,
  readerEntriesToWalk,
  readerFilesUrl,
} from "../src/lib/vocab/reader";
import { upsertAnki } from "../src/lib/vocab/sync";

const DEFAULT_ANKI = "http://127.0.0.1:8765";
const DEFAULT_DECK = "Smart Book";
const DEFAULT_MODEL =
  "Word+Part of Speech+Transcription+Translation+Context+Additional";
const CURL_RETRY_COUNT = 3;
const CURL_RETRY_DELAY_SECONDS = 1;
const CURL_MAX_TIME_SECONDS = 30;
const CURL_EXIT_COULD_NOT_RESOLVE = 6;
const CURL_EXIT_COULD_NOT_CONNECT = 7;
const CURL_EXIT_TIMEOUT = 28;
const CURL_EXIT_EMPTY_REPLY = 52;
const CURL_EXIT_RECV_ERROR = 56;
const READER_OFFLINE_EXIT_CODES = new Set([
  CURL_EXIT_COULD_NOT_RESOLVE,
  CURL_EXIT_COULD_NOT_CONNECT,
  CURL_EXIT_TIMEOUT,
  CURL_EXIT_EMPTY_REPLY,
  CURL_EXIT_RECV_ERROR,
]);
const MAX_VOCAB_BYTES = 8 * 1024 * 1024;
const CACHE_ID_CHARS = 16;
const EPUB_CACHE_DIR = join(homedir(), ".cache", "quiosco", "epubs");
const ROOT_DIRECTORY = "/";

class ReaderOfflineError extends Error {}

const { values } = parseArgs({
  options: {
    vocab: { type: "string" },
    epub: { type: "string" },
    reader: { type: "string" },
    anki: { type: "string", default: DEFAULT_ANKI },
    deck: { type: "string", default: DEFAULT_DECK },
    model: { type: "string", default: DEFAULT_MODEL },
    "skip-anki": { type: "boolean", default: false },
  },
});

function curlFlags(): string[] {
  return [
    "-fsS",
    "--retry",
    String(CURL_RETRY_COUNT),
    "--retry-all-errors",
    "--retry-delay",
    String(CURL_RETRY_DELAY_SECONDS),
    "--max-time",
    String(CURL_MAX_TIME_SECONDS),
  ];
}

function runCurl(args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile(
      "curl",
      args,
      { encoding: "buffer", maxBuffer: MAX_VOCAB_BYTES },
      (error, stdout, stderr) => {
        if (error) {
          const exitCode =
            typeof error.code === "number" ? error.code : undefined;
          const detail = stderr.toString("utf8").trim() || error.message;
          reject(
            exitCode !== undefined && READER_OFFLINE_EXIT_CODES.has(exitCode)
              ? new ReaderOfflineError(detail)
              : new Error(detail),
          );
          return;
        }
        resolve(stdout);
      },
    );
  });
}

async function curlBytes(url: string): Promise<Uint8Array> {
  return new Uint8Array(await runCurl([...curlFlags(), url]));
}

async function curlToFile(url: string, destination: string): Promise<void> {
  await runCurl([...curlFlags(), "-o", destination, url]);
}

function collectCards(results: readonly LookupResult[], cards: VocabCard[]) {
  for (const result of results) {
    if (!result.ok) {
      console.error(`skipped ${result.word || "line"}: ${result.reason}`);
      continue;
    }
    cards.push(result.card);
  }
}

function cacheFile(readerPath: string, size: number): string {
  const digest = createHash("sha256")
    .update(`${readerPath}\n${size}`)
    .digest("hex")
    .slice(0, CACHE_ID_CHARS);
  return join(EPUB_CACHE_DIR, `${digest}.epub`);
}

async function listEpubs(reader: string): Promise<ReaderEpubFile[]> {
  const epubs: ReaderEpubFile[] = [];
  const pending = [ROOT_DIRECTORY];
  const seen = new Set<string>();
  while (pending.length > 0) {
    const directory = pending.shift();
    if (!directory || seen.has(directory)) continue;
    seen.add(directory);
    const listing = parseReaderListing(
      JSON.parse(
        new TextDecoder().decode(
          await curlBytes(readerFilesUrl(reader, directory)),
        ),
      ),
    );
    const walk = readerEntriesToWalk(directory, listing);
    epubs.push(...walk.epubs);
    pending.push(...walk.directories);
  }
  return epubs;
}

async function epubBytes(
  reader: string,
  item: ReaderEpubFile,
): Promise<Uint8Array> {
  mkdirSync(EPUB_CACHE_DIR, { recursive: true });
  const cachedPath = cacheFile(item.path, item.size);
  if (existsSync(cachedPath) && statSync(cachedPath).size === item.size) {
    return new Uint8Array(readFileSync(cachedPath));
  }
  const partialPath = `${cachedPath}.partial`;
  try {
    await curlToFile(readerDownloadUrl(reader, item.path), partialPath);
    const actual = statSync(partialPath).size;
    if (item.size > 0 && actual !== item.size) {
      throw new Error(`book size is ${actual}, reader says ${item.size}`);
    }
    renameSync(partialPath, cachedPath);
  } catch (error) {
    rmSync(partialPath, { force: true });
    throw error;
  }
  return new Uint8Array(readFileSync(cachedPath));
}

async function main(): Promise<number> {
  const reader = values.reader;
  if ((!values.vocab && !reader) || (!values.epub && !reader)) {
    console.error("Usage: pnpm vocab:sync -- --reader http://crosspoint.local");
    return 2;
  }

  const vocabText = values.vocab
    ? readFileSync(values.vocab, "utf8")
    : new TextDecoder().decode(
        await curlBytes(
          readerDownloadUrl(reader ?? DEFAULT_READER, READER_VOCAB_PATH),
        ),
      );
  const lines = vocabText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const { groups, skipped } = groupLookups(lines);
  for (const line of skipped) {
    console.error(`skipped ${lookupWord(line) || "line"}: invalid-line`);
  }

  const cards: VocabCard[] = [];
  const singleEpub = values.epub
    ? new Uint8Array(readFileSync(values.epub))
    : null;
  if (singleEpub) {
    for (const group of groups) {
      collectCards(
        group.lines.map((line) => cardsFromBook(singleEpub, line)),
        cards,
      );
    }
  } else {
    const catalog = await listEpubs(reader ?? DEFAULT_READER);
    const cachedFirst = [
      ...catalog.filter((item) => existsSync(cacheFile(item.path, item.size))),
      ...catalog.filter((item) => !existsSync(cacheFile(item.path, item.size))),
    ];
    for (const group of groups) {
      const results = await cardsFromCatalog(
        group.lines,
        group.identity,
        cachedFirst,
        async (path) => {
          const item = catalog.find((entry) => entry.path === path);
          if (!item) return null;
          const bytes = await epubBytes(reader ?? DEFAULT_READER, item);
          const identity = epubIdentity(bytes);
          return identity ? { identity, bytes } : null;
        },
      );
      if (results.some((result) => result.ok)) {
        console.log(group.identity.title);
      }
      collectCards(results, cards);
    }
  }

  if (values["skip-anki"] || cards.length === 0) return 0;

  try {
    const counts = await upsertAnki({
      fetch,
      ankiUrl: values.anki ?? DEFAULT_ANKI,
      deck: values.deck ?? DEFAULT_DECK,
      model: values.model ?? DEFAULT_MODEL,
      cards,
    });
    console.log(`anki created ${counts.created}, updated ${counts.updated}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "anki failed";
    console.error(
      `Anki did not take the cards (${message}). Open Anki and run this command again.`,
    );
  }
  return 0;
}

try {
  process.exit(await main());
} catch (error) {
  if (error instanceof ReaderOfflineError) {
    console.error("Reader is not reachable. Leave File Transfer open.");
    process.exit(0);
  }
  const message = error instanceof Error ? error.message : "vocab sync failed";
  console.error(message);
  process.exit(1);
}
