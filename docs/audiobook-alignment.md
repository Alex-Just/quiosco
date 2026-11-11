# Narrated audiobooks: building a pack

A narrated book plays a recorded audiobook instead of synthesized speech: tap a
sentence and you hear the narrator read that exact sentence. The mapping is
computed once, offline, by `pnpm audiobook`.

This document is the runbook for adding a new book.

## How the mapping works

The reader derives everything from the EPUB:

1. The importer turns the EPUB spine into chapters. This usually includes front
   matter (cover, title page, section pages) and sometimes an author bio.
2. `bookFlatParagraphs` flattens every chapter into paragraphs, with the
   chapter title as the first paragraph.
3. `bookSentenceUnits` splits those paragraphs into sentence units. These units
   are what the Zen reader shows one per screen, and what a tap plays.

A pack must contain exactly one manifest entry per parsed chapter, in the same
order. The CLI parses the EPUB with the same code the app uses, so unit indices
match by construction.

Audiobooks do not usually include that front matter, so track 1 is rarely
chapter 0. `--skip N` says that track 1 narrates parsed chapter N. The pack
still carries one entry per chapter, with empty entries for the ones the
recording does not cover.

`--dry-run` prints the whole mapping before any work starts.

## Prerequisites

- `ffmpeg` and `ffprobe` on `PATH` (transcoding and duration probing).
- [`uv`](https://docs.astral.sh/uv/) for the transcription step. The first run
  downloads mlx-whisper and the Whisper model.
- Apple Silicon for the default `mlx-community/whisper-large-v3-turbo` model.

## Steps

1. Put the EPUB and the audio files somewhere you can read.

2. Check the mapping first:

   ```bash
   pnpm audiobook --epub book.epub --audio audiobook-dir --dry-run
   ```

   The output lists every parsed chapter with the track that will narrate it.
   Compare the titles with your file names. Chapters marked `-` get no audio
   and keep using TTS.

3. If the track count differs from the chapter count, pass `--skip`. Without
   it, the tool prints the chapter table and suggests the longest contiguous
   window, which is the usual front-matter offset.

4. Build the pack:

   ```bash
   pnpm audiobook \
     --epub book.epub \
     --audio audiobook-dir \
     --skip 3 \
     --prompt "Character names, places, invented words"
   ```

   `--prompt` helps the recognizer with proper nouns it would otherwise guess
   wrong.

5. Read the per-chapter match percentage as it prints. 95% and above is
   healthy. Below 80% the track is probably not that chapter, or the ebook is a
   different edition.

6. Import the resulting `.zip`: open the book, **More**, **Add audiobook**.

## Time and size

Measured on an M4 with `whisper-large-v3-turbo`: about **8.5 times realtime**.
A 45 minute chapter takes 5 to 6 minutes. A 30 hour book takes roughly 3.5
hours.

The pack is mono Opus at 32 kbps by default, about **14 MB per hour**. A 30
hour book is roughly 430 MB. `--copy` keeps the original files instead, which
is faster but several times larger.

## What the tool checks

- **Count.** More audio files than chapters stops the run and asks you to merge
  tracks.
- **Integrity.** Every file is scanned for long runs of zero bytes. A
  half-downloaded MP3 keeps its final size and passes `ffprobe`, but it is
  padded with zeros and transcribes as garbage. The scan catches that before an
  hour of transcription is spent.
- **Coverage.** Each chapter reports the share of book tokens matched to a
  transcript token.
- **Edition.** The app refuses a pack whose chapter count differs from the
  open book, and says so.

## Resuming and rebuilding

Transcripts are cached per chapter in `<epub name>.narration-transcripts/`, and
existing files are skipped. An interrupted run continues where it stopped. To
rebuild after adding missing chapters, run the same command: only the new
chapters are transcribed, and the pack is rewritten.

The cache is keyed by track number, not by audio content. If you insert,
remove or reorder tracks, delete the cache folder (or every transcript from the
first changed track onward) before rebuilding. Otherwise old transcripts are
reused for different audio, and the alignment silently drifts.

## Troubleshooting

**"these audio files are incomplete"**  
The named files contain large zero runs. Re-download them. Their size can look
correct because the download tool preallocates the final length.

**The suggested offset looks wrong**  
Run `--dry-run` and compare the chapter titles with the audio file names. If
the audio skips a chapter that the EPUB has, or the order differs, the pack
cannot align correctly; use a complete, in-order set.

**"This pack was built for a different edition of this book"**  
The EPUB imported into Quiosco has a different chapter count than the one used
to build the pack. Import the same EPUB file, or rebuild from that file.

**Low match percentage on one chapter**  
Usually a wrong track for that chapter, an abridged recording, or a different
translation. A single low chapter in an otherwise good book is usually a
misnumbered track.

**macOS refuses to read the source folder**  
Files under `Downloads` or iCloud can be blocked for a background process even
when the user can read them. Copy the folder somewhere neutral, grant Full Disk
Access, or let the user pick it in a folder dialog so the system records a
grant.

## Code map

| Path | Role |
| --- | --- |
| `scripts/audiobook.ts` | CLI: parse, check, transcribe, align, write the pack |
| `scripts/audiobook/transcribe.py` | mlx-whisper wrapper, one JSON per track |
| `src/lib/narration/align.ts` | Needleman-Wunsch alignment of text to transcript |
| `src/lib/narration/manifest.ts` | pack format and validation |
| `src/lib/narration/zip.ts` | central-directory reader and byte-range slices |
| `src/lib/narration/pack.ts` | zip to stored pack |
| `src/lib/narration/player.ts` | plays one sentence range |
| `src/lib/useNarration.ts` | per-book pack state and playback |

## Pack format

```text
narration.json
audio/001.ogg
audio/002.ogg
...
```

`narration.json`:

```json
{
  "version": 1,
  "title": "Book title",
  "chapters": [
    {
      "audio": "audio/001.ogg",
      "duration": 2751.03,
      "starts": [0, 12.4],
      "ends": [12.4, 30.1]
    }
  ]
}
```

One chapter entry per parsed chapter. A chapter with no recording has
`"audio": ""` and empty time arrays.

Audio entries are stored without compression, so the archive can be sliced by
byte range and played without extracting it. The app keeps the zip as a single
Blob in IndexedDB and creates an object URL for the requested range at playback
time.
