/**
 * Build a narration pack for an EPUB from a recorded audiobook.
 *
 *   pnpm audiobook --epub book.epub --audio audiobook-dir/
 *
 * The pack is one zip: `narration.json` plus one audio entry per chapter. Every
 * sentence unit the reader will render gets a [start, end] range in that
 * chapter's audio, so tapping a sentence plays the narrator's own voice.
 *
 * The EPUB is parsed with the app's own importer and splitter, so unit indices
 * line up with what BookReader renders. Transcription is cached per chapter:
 * an interrupted run picks up where it stopped.
 */

import { execFileSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Zip, ZipDeflate, ZipPassThrough } from "fflate";
import { newArticle } from "../src/lib/article";
import {
  bookChapterStarts,
  bookFlatParagraphs,
  bookSentenceUnits,
  bookUnitStarts,
} from "../src/lib/bookText";
import { type ParsedBook, parseEpub } from "../src/lib/epub/parseEpub";
import { alignChapter, type TimedWord } from "../src/lib/narration/align";
import {
  MANIFEST_ENTRY,
  MANIFEST_VERSION,
  type NarrationManifest,
  type NarrationManifestChapter,
} from "../src/lib/narration/manifest";
import type { BookChapter } from "../src/lib/types";

// --epub parsing runs the browser importer: give it the globals it expects.
const nodeRequire = createRequire(import.meta.url);
const { JSDOM } = nodeRequire("jsdom") as {
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

/** Audio containers worthy of an audiobook track. */
const AUDIO_EXTENSIONS = new Set([
  ".mp3",
  ".m4a",
  ".m4b",
  ".aac",
  ".ogg",
  ".opus",
  ".flac",
  ".wav",
]);

/** Below this, a chapter is probably not the chapter the pack claims. */
const COVERAGE_WARN = 0.8;

const TRANSCRIBE_SCRIPT = fileURLToPath(
  new URL("./audiobook/transcribe.py", import.meta.url),
);

const USAGE = `Build a narration pack from an EPUB and its audiobook.

  pnpm audiobook --epub <book.epub> --audio <dir> [options]

  --epub <file>         EPUB the pack is aligned to (required)
  --audio <dir>         One file per narrated chapter, in chapter order (required)
  --out <file.zip>      Pack to write (default: <epub name>.narration.zip)
  --transcripts <dir>   Word-timestamp cache (default: <epub name>.narration-transcripts)
  --skip <n>            Chapter index track 1 narrates (front matter is not
                        in the audiobook); required when the counts differ
  --dry-run             Print the track-to-chapter mapping and stop
  --copy                Keep the source audio instead of transcoding to Opus
  --bitrate <rate>      Opus bitrate when transcoding (default: 32k)
  --model <repo>        mlx-whisper model (default: whisper-large-v3-turbo)
  --language <code>     Spoken language (default: es)
  --prompt <text>       Initial prompt; character names help the recognizer
  --no-transcribe       Align from the existing cache only
  --help                This text
`;

interface Options {
  epub: string;
  audio: string;
  out: string;
  transcripts: string;
  skip: number | null;
  dryRun: boolean;
  copy: boolean;
  bitrate: string;
  model: string;
  language: string;
  prompt: string | null;
  transcribe: boolean;
}

function fail(message: string): never {
  console.error(`audiobook: ${message}`);
  process.exit(1);
}

function parseArgs(argv: readonly string[]): Options {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  const known = new Set([
    "--epub",
    "--audio",
    "--out",
    "--transcripts",
    "--skip",
    "--bitrate",
    "--model",
    "--language",
    "--prompt",
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined) break;
    if (arg === "--help" || arg === "-h") {
      console.log(USAGE);
      process.exit(0);
    }
    if (!arg.startsWith("--")) fail(`unexpected argument: ${arg}`);
    if (arg === "--copy" || arg === "--no-transcribe" || arg === "--dry-run") {
      flags.add(arg);
      continue;
    }
    if (!known.has(arg)) fail(`unknown option: ${arg} (see --help)`);
    const value = argv[index + 1];
    if (value === undefined) fail(`${arg} needs a value`);
    values.set(arg, value);
    index += 1;
  }

  const epub = values.get("--epub");
  const audio = values.get("--audio");
  if (!epub) fail("--epub is required");
  if (!audio) fail("--audio is required");
  if (!existsSync(epub)) fail(`no such EPUB: ${epub}`);
  if (!existsSync(audio)) fail(`no such audio directory: ${audio}`);

  const stem = basename(epub, extname(epub));
  const out = resolve(values.get("--out") ?? `${stem}.narration.zip`);
  const transcripts = resolve(
    values.get("--transcripts") ?? `${stem}.narration-transcripts`,
  );
  const skipValue = values.get("--skip");
  const skip = skipValue === undefined ? null : Number(skipValue);
  if (skip !== null && !Number.isInteger(skip)) {
    fail(`--skip needs a whole chapter index, got "${skipValue}"`);
  }

  return {
    epub: resolve(epub),
    audio: resolve(audio),
    out,
    transcripts,
    skip,
    dryRun: flags.has("--dry-run"),
    copy: flags.has("--copy"),
    bitrate: values.get("--bitrate") ?? "32k",
    model: values.get("--model") ?? "mlx-community/whisper-large-v3-turbo",
    language: values.get("--language") ?? "es",
    prompt: values.get("--prompt")?.trim() || null,
    transcribe: !flags.has("--no-transcribe"),
  };
}

const collator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

function audioFiles(directory: string): string[] {
  return readdirSync(directory)
    .filter((name) => AUDIO_EXTENSIONS.has(extname(name).toLowerCase()))
    .sort(collator.compare)
    .map((name) => join(directory, name));
}

/** A run of zeros this long is missing audio, not a pause. */
const ZERO_RUN_LIMIT = 1_000_000;
/** Normal speech has almost no zero bytes; this much means holes. */
const ZERO_FRACTION_LIMIT = 0.05;

/**
 * Why this track cannot be used, or null. A half-downloaded MP3 keeps its
 * final size but is padded with zeros, so it probes as valid and transcribes
 * as garbage; the byte scan is what catches it.
 */
function audioProblem(path: string): string | null {
  const size = statSync(path).size;
  if (size === 0) return "empty file";

  // PCM WAV encodes silence as zero samples, so a valid recording with pauses
  // would trip the scan below. It targets compressed files whose truncated
  // downloads are padded with zeros.
  if (extname(path).toLowerCase() === ".wav") return null;

  const descriptor = openSync(path, "r");
  try {
    const buffer = Buffer.alloc(1 << 20);
    let zeros = 0;
    let run = 0;
    let longest = 0;
    let read = readSync(descriptor, buffer, 0, buffer.length, null);
    while (read > 0) {
      for (let index = 0; index < read; index += 1) {
        if (buffer[index] === 0) {
          zeros += 1;
          run += 1;
          if (run > longest) longest = run;
        } else {
          run = 0;
        }
      }
      read = readSync(descriptor, buffer, 0, buffer.length, null);
    }
    if (zeros / size > ZERO_FRACTION_LIMIT || longest > ZERO_RUN_LIMIT) {
      const percent = ((zeros / size) * 100).toFixed(0);
      const gap = (longest / 1_000_000).toFixed(1);
      return `${percent}% zero bytes, longest gap ${gap} MB`;
    }
  } finally {
    closeSync(descriptor);
  }
  return null;
}

/** Refuse to spend an hour transcribing files that cannot produce a pack. */
function checkAudio(files: readonly string[]): void {
  const problems: string[] = [];
  const progress = process.stdout.isTTY;
  files.forEach((file, index) => {
    if (progress) {
      process.stdout.write(`\rChecking audio ${index + 1}/${files.length}…`);
    }
    const problem = audioProblem(file);
    if (problem) problems.push(`  ${basename(file)}: ${problem}`);
  });
  if (progress) process.stdout.write("\r");
  if (problems.length > 0) {
    fail(
      `these audio files are incomplete; re-download them:\n${problems.join("\n")}`,
    );
  }
}

function pad(chapter: number): string {
  return String(chapter).padStart(3, "0");
}

function run(command: string, args: readonly string[]): void {
  try {
    execFileSync(command, args, { stdio: ["ignore", "ignore", "pipe"] });
  } catch (error) {
    const stderr = (error as { stderr?: Buffer }).stderr;
    const detail = stderr?.toString().trim().split("\n").slice(-2).join(" ");
    fail(`${command} failed${detail ? `: ${detail}` : ""}`);
  }
}

function durationOf(path: string): number {
  try {
    const printed = execFileSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=nw=1:nk=1",
        path,
      ],
      { encoding: "utf8" },
    );
    const seconds = Number.parseFloat(printed.trim());
    return Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  } catch {
    fail(`ffprobe could not read ${basename(path)}`);
  }
}

interface Transcript {
  words: TimedWord[];
}

function readTranscript(path: string): TimedWord[] {
  if (!existsSync(path)) {
    fail(`missing transcript ${path} (drop --no-transcribe to build it)`);
  }
  const parsed = JSON.parse(readFileSync(path, "utf8")) as Transcript;
  if (!Array.isArray(parsed.words)) fail(`${path}: no "words" array`);
  return parsed.words;
}

/** Transcode one chapter to mono Opus and return the staged file. */
function transcode(
  source: string,
  workDirectory: string,
  chapter: number,
  bitrate: string,
): string {
  const target = join(workDirectory, `${pad(chapter)}.ogg`);
  run("ffmpeg", [
    "-y",
    "-nostdin",
    "-loglevel",
    "error",
    "-i",
    source,
    "-vn",
    "-map_metadata",
    "-1",
    "-ac",
    "1",
    "-c:a",
    "libopus",
    "-b:a",
    bitrate,
    target,
  ]);
  return target;
}

function transcribe(
  jobs: Array<{ audio: string; out: string }>,
  options: Options,
): void {
  const work = mkdtempSync(join(tmpdir(), "quiosco-audiobook-"));
  const plan = join(work, "jobs.json");
  writeFileSync(
    plan,
    JSON.stringify({
      model: options.model,
      language: options.language,
      prompt: options.prompt,
      jobs,
    }),
  );
  try {
    execFileSync(
      "uv",
      [
        "run",
        "--quiet",
        "--with",
        "mlx-whisper",
        "python",
        TRANSCRIBE_SCRIPT,
        plan,
      ],
      { stdio: "inherit" },
    );
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") {
      fail("uv is required to transcribe (https://docs.astral.sh/uv/)");
    }
    fail("transcription failed");
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

function round(seconds: number): number {
  return Math.round(seconds * 1000) / 1000;
}

/**
 * Which book chapter track 1 narrates. Audiobooks rarely include the cover,
 * title page, or author bio the EPUB spine carries, so the counts usually
 * differ; when they do, the reader picks the window rather than guessing.
 */
function resolveSkip(
  requested: number | null,
  chapters: readonly BookChapter[],
  tracks: number,
  previewOnly = false,
): number {
  const total = chapters.length;
  if (requested !== null) {
    if (requested < 0 || requested + tracks > total) {
      fail(
        `--skip ${requested} does not fit: ${tracks} track(s) over ${total} chapters`,
      );
    }
    return requested;
  }
  if (tracks === total) return 0;

  const suggestion = suggestSkip(chapters, tracks);
  // A dry run is how the reader chooses the offset, so it must not stop here.
  if (previewOnly) {
    console.log(
      `\nThis EPUB has ${total} chapters; the audiobook has ${tracks}. ` +
        `Previewing --skip ${suggestion}.`,
    );
    return suggestion;
  }

  console.log(
    `\nThis EPUB has ${total} chapters; the audiobook has ${tracks}.`,
  );
  chapters.forEach((chapter, index) => {
    const mark =
      index === suggestion
        ? "  <-- track 1"
        : index === suggestion + tracks
          ? "  <-- end"
          : "";
    console.log(
      `  ${String(index).padStart(2)}  ${String(chapter.text.length).padStart(6)} chars  ${chapter.title}${mark}`,
    );
  });
  fail(
    `pass --skip <n> to say which chapter track 1 narrates (suggested: ${suggestion})`,
  );
}

/** Longest contiguous window of `tracks` chapters: front matter is short. */
function suggestSkip(chapters: readonly BookChapter[], tracks: number): number {
  let best = 0;
  let bestLength = -1;
  let running = 0;
  for (let index = 0; index < chapters.length; index += 1) {
    running += chapters[index]?.text.length ?? 0;
    const leaving = chapters[index - tracks];
    if (leaving) running -= leaving.text.length;
    if (index >= tracks - 1 && running > bestLength) {
      bestLength = running;
      best = index - tracks + 1;
    }
  }
  return best;
}

/** Write the pack: manifest deflated, chapter audio stored for slicing. */
function writePack(
  out: string,
  manifest: NarrationManifest,
  files: ReadonlyMap<string, string>,
): void {
  const descriptor = openSync(out, "w");
  let closed = false;
  let failure: Error | null = null;

  const zip = new Zip((error, chunk, final) => {
    if (error) {
      failure = error;
      return;
    }
    writeSync(descriptor, chunk);
    if (final && !closed) {
      closeSync(descriptor);
      closed = true;
    }
  });

  try {
    const head = new ZipDeflate(MANIFEST_ENTRY, { level: 9 });
    zip.add(head);
    head.push(new TextEncoder().encode(JSON.stringify(manifest)), true);
    for (const chapter of manifest.chapters) {
      const source = files.get(chapter.audio);
      if (!source) continue;
      const entry = new ZipPassThrough(chapter.audio);
      zip.add(entry);
      entry.push(new Uint8Array(readFileSync(source)), true);
    }
    zip.end();
  } finally {
    if (!closed) closeSync(descriptor);
  }
  if (failure) {
    const reason = (failure as Error | null)?.message ?? "unknown error";
    fail(`could not write ${out}: ${reason}`);
  }
}

async function readBook(path: string): Promise<ParsedBook> {
  try {
    return await parseEpub(new Uint8Array(readFileSync(path)));
  } catch (error) {
    fail(
      `could not read the EPUB: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const book = await readBook(options.epub);

  const article = {
    ...newArticle({ url: null, title: book.title, text: "", via: "manual" }),
    kind: "book" as const,
    chapters: book.chapters,
  };
  const paragraphs = bookFlatParagraphs(article);
  const units = bookSentenceUnits(paragraphs);
  const chapterStarts = bookChapterStarts(article);
  const unitStarts = bookUnitStarts(units, chapterStarts);

  if (book.chapters.length === 0) fail("the EPUB has no chapters");
  if (units.length === 0) fail("the EPUB has no sentence text");

  const audio = audioFiles(options.audio);
  if (audio.length === 0) fail(`no audio files in ${options.audio}`);
  if (audio.length > book.chapters.length) {
    fail(
      `${audio.length} audio files but only ${book.chapters.length} chapters; ` +
        "merge tracks down to one per chapter",
    );
  }

  const skip = resolveSkip(
    options.skip,
    book.chapters,
    audio.length,
    options.dryRun,
  );
  checkAudio(audio);

  // Track n of the audiobook narrates book chapter `skip + n`; every other
  // chapter stays empty so pack indices keep matching the reader's.
  const trackOfChapter = new Map<number, number>();
  audio.forEach((_, track) => {
    trackOfChapter.set(skip + track, track);
  });

  if (options.dryRun) {
    console.log(
      `\n${book.chapters.length} chapters, ${audio.length} tracks, --skip ${skip}\n`,
    );
    book.chapters.forEach((chapter, index) => {
      const track = trackOfChapter.get(index);
      const label =
        track === undefined ? "  -  " : ` ${String(track + 1).padStart(3)} `;
      console.log(`${label}  ${String(index).padStart(3)}  ${chapter.title}`);
    });
    return;
  }

  mkdirSync(options.transcripts, { recursive: true });
  const transcriptFiles = audio.map((_, index) =>
    join(options.transcripts, `${pad(index + 1)}.json`),
  );

  if (options.transcribe) {
    const pending = audio.flatMap((source, index) => {
      const out = transcriptFiles[index];
      return out && !existsSync(out) ? [{ audio: source, out }] : [];
    });
    if (pending.length > 0) {
      console.log(`Transcribing ${pending.length} chapter(s)…`);
      transcribe(pending, options);
    } else {
      console.log("Transcripts are cached.");
    }
  }

  const work = mkdtempSync(join(tmpdir(), "quiosco-pack-"));
  const staged: string[] = [];
  try {
    audio.forEach((source, index) => {
      if (options.copy) {
        staged.push(source);
        return;
      }
      process.stdout.write(`\rEncoding chapter ${index + 1}/${audio.length}…`);
      staged.push(transcode(source, work, index + 1, options.bitrate));
    });
    if (!options.copy) process.stdout.write("\n");

    const files = new Map<string, string>();
    let weak = 0;
    const chapters: NarrationManifestChapter[] = book.chapters.map(
      (chapter, index) => {
        const track = trackOfChapter.get(index);
        if (track === undefined) {
          return { audio: "", duration: 0, starts: [], ends: [] };
        }
        const stagedPath = staged[track];
        const transcriptPath = transcriptFiles[track];
        if (!stagedPath || !transcriptPath) {
          fail(`internal: track ${track + 1} has no audio or transcript`);
        }
        const slice = units
          .slice(unitStarts[index] ?? 0, unitStarts[index + 1] ?? units.length)
          .map((unit) => unit.text);
        const duration = durationOf(stagedPath);
        const aligned = alignChapter(
          slice,
          readTranscript(transcriptPath),
          duration,
        );
        if (aligned.coverage < COVERAGE_WARN) weak += 1;
        console.log(
          `[track ${track + 1}] ${chapter.title}: ` +
            `${slice.length} units, ${(aligned.coverage * 100).toFixed(1)}% matched` +
            (aligned.coverage < COVERAGE_WARN
              ? "  <-- check this chapter"
              : ""),
        );
        const name = `audio/${pad(track + 1)}${extname(stagedPath) || ".ogg"}`;
        files.set(name, stagedPath);
        return {
          audio: name,
          duration: round(aligned.ends.at(-1) ?? duration),
          starts: aligned.starts.map(round),
          ends: aligned.ends.map(round),
        };
      },
    );

    const manifest: NarrationManifest = {
      version: MANIFEST_VERSION,
      title: book.title,
      chapters,
    };

    writePack(options.out, manifest, files);
    console.log(
      `\nWrote ${options.out}` +
        (weak > 0
          ? `\n${weak} chapter(s) matched below ${COVERAGE_WARN * 100}%; the ` +
            "audio may not be that chapter, or the text edition differs."
          : ""),
    );
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  fail(error instanceof Error ? error.message : String(error));
});
