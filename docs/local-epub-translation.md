# Local EPUB translation (OpenCode app)

`scripts/translate-epub.ts` translates an EPUB on the Mac through the OpenCode
app's local service. It reuses the reader's sentence splitting, window
planning, prompt builder, numbered-reply parser, content-addressed cache, and
bilingual EPUB writer. It does not use the Cloudflare Worker, `OPENCODE_API_KEY`
or `APP_TOKEN`.

## Requirements

- OpenCode app or CLI with a model you can use. The CLI must be on `PATH` as
  `opencode`, or passed with `--opencode <path>`.
- `pnpm install` (the CLI uses `vite-node` and `jsdom`, both dev dependencies).
- The project agent at `.opencode/agents/translate-epub.md`. It is tracked in
  this repository; the CLI runs with the repository root as its working
  directory so the agent is always found.

## Quick start

```bash
# Inspect a book without translating
pnpm translate:epub /path/to/book.epub --dry-run

# Translate with the default free model
pnpm translate:epub /path/to/book.epub

# Translate with the non-free OpenCode Go model
pnpm translate:epub /path/to/book.epub \
  --model opencode-go/deepseek-v4.1-flash
```

The default output is `<book title>-bilingual.epub` next to the input. Override
it with `--output`. The default cache is
`~/.cache/quiosco/epub-translations.json`; override it with `--cache`.

## Models and access

The default is `opencode/deepseek-v4.1-flash-free`. It is a free-tier model and
must be called through `opencode run`, not through the stateless generation
API. OpenCode may block the free tier when it detects abusive traffic from an
IP address; the error appears in the log. In that case switch to a Go model:

```bash
--model opencode-go/deepseek-v4.1-flash
```

List available models with:

```bash
opencode models
```

The free tier is cloud inference, not offline. For a fully offline run,
configure Ollama or LM Studio as an OpenCode provider and pass that model with
`--model`.

### Why a project agent exists

`.opencode/agents/translate-epub.md` sets `steps: 1`, which removes tools from
the single model step, and gives the model a translation-only system prompt.
That keeps each window a pure text-to-text request. Do **not** replace
`steps: 1` with a broad permissions deny rule: OpenCode's free tier rejects
that request shape.

## How it works

1. `parseEpub` unzips the book and extracts chapters locally.
2. `bookSentenceUnits` splits each paragraph into sentence units. Letterless
   units are marked skipped.
3. `nextWindow` selects the next uncached window: up to 4,000 characters and
   60 sentences, plus 1,200 characters of source context on each side.
4. `buildBookSystemPrompt` and `buildBookUserMessage` produce the tagged
   `<before>`, `<translate>`, `<after>` request.
5. `opencode run --agent translate-epub --format json` returns JSONL. The CLI
   collects assistant text and `parseNumberedTranslations` accepts only the
   strict numbered prefix.
6. Accepted sentences are paired with their source text and written to the
   JSON cache after every window. A partial reply is accepted; the next window
   starts at the first missing sentence.
7. `assembleExportChapters` and `buildEpubBytes` write the EPUB, using the same
   display pairing as the reader's export.

## Cache and resume

The cache is content-addressed by normalized source text, target language and
rules hash. The model is recorded in an entry but is not part of the key, so a
sentence translated by one model can be reused by another. The cache is shared
across books. Re-running the same command resumes from the cache; an
interrupted window is simply retried.

Each save writes a temporary file and atomically renames it over the cache, so
a crash cannot leave half-written JSON. Saves also take an inter-process lock
and merge entries already on disk, so two books can share one cache without
either run overwriting the other's work. A corrupt or unsupported cache is
reported with an instruction to delete it or pass another `--cache`.

## Long runs

A full novel can take hours. Keep the Mac awake and detach the process:

```bash
screen -dmS book-translation /bin/zsh -lc '
  cd /path/to/quiosco
  for attempt in 1 2 3 4 5; do
    caffeinate -i pnpm translate:epub /path/to/book.epub \
      --model opencode-go/deepseek-v4.1-flash \
      --timeout-ms 180000 \
      --cache ~/.cache/quiosco/book.json \
      --output /path/to/book-bilingual.epub \
      >> /tmp/book-translation.log 2>&1 && exit 0
    sleep 30
  done
  exit 1
'
```

Monitor with `screen -ls` and `tail -f /tmp/book-translation.log`. The
supervisor restarts after a failure; the cache makes each restart resumable.
The per-window timeout defaults to three minutes.

## Options

| Option | Meaning |
| --- | --- |
| `-o, --output <path>` | Output EPUB path |
| `--cache <path>` | Translation cache JSON |
| `--model <provider/model>` | Model for `opencode run` |
| `--target-language <lang>` | Target language (default `Russian`) |
| `--rules-file <path>` | Override the built-in translation rules |
| `--max-windows <n>` | Translate at most `n` windows, then export a partial book |
| `--timeout-ms <ms>` | Per-window timeout (default `180000`) |
| `--opencode <path>` | OpenCode binary |
| `--dry-run` | Parse and print counts without translating |
| `-h, --help` | Show help |

## Output

The output is the same **bilingual, text-only** EPUB the reader exports:

- Each paragraph contains the source sentence followed by its translation.
- Language flag markers are stripped for e-reader fonts.
- Original images, cover and CSS are not carried over.
- Chapter titles come from the source EPUB; the title paragraph is not repeated
  in the chapter body.

The built-in rules are Spanish-to-Russian. The CLI refuses to use them when
the EPUB's metadata source language is not Spanish or when the target is not
Russian; pass a `--rules-file` for any other combination. The display pairing
in `pairSourceWithTranslation` is also Spanish-source by convention; a
source-language-aware pairing would be a separate change.

## Troubleshooting

- **`opencode run exited with 1: ...`** — the message after the colon is the
  provider error. A free-tier IP block says the free models are unavailable
  from the current network; switch to `opencode-go/deepseek-v4.1-flash`.
- **`ECONNRESET` or a stalled window** — the CLI retries three times with a
  three-minute timeout per attempt. The supervisor restarts the process. The
  cache retains every completed window.
- **`opencode` not found** — install the OpenCode CLI or pass
  `--opencode /path/to/opencode`.
- **Agent not found** — ensure
  `.opencode/agents/translate-epub.md` exists and the command runs from the
  repository root (the CLI sets this automatically).
- **Built-in rules refused** — the book is not Spanish or the target is not
  Russian. Pass `--rules-file` with rules for that language pair.
- **Corrupt cache** — delete the cache file or pass `--cache` with a new path.
- **Output equals the cache or input** — the CLI rejects this before
  translating; choose a different `--output`.
- **Partial output** — `--max-windows` or a stopped run still exports what is
  translated; the rest falls back to source text.

## Verification and tests

```bash
pnpm typecheck
pnpm lint
pnpm vitest run tests/translateEpub.test.ts
```

To sanity-check an exported EPUB:

```bash
unzip -t book-bilingual.epub
unzip -p book-bilingual.epub OEBPS/content.opf | head
```

The focused tests cover the model-reference parser, JSONL error handling, cache
persistence and validation, resume after a partial window, retries, and stale
cache rejection.
