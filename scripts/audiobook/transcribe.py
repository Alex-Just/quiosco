#!/usr/bin/env python3
"""Word-level transcription for the audiobook aligner.

Runs mlx-whisper over one audio file per job and writes the words with their
times as JSON. Jobs whose output already exists are skipped, so an interrupted
run resumes for free.

    uv run --with mlx-whisper python scripts/audiobook/transcribe.py jobs.json

`jobs.json` is written by `pnpm audiobook`:

    {
      "model": "mlx-community/whisper-large-v3-turbo",
      "language": "es",
      "prompt": null,
      "jobs": [{"audio": "/abs/1.mp3", "out": "/abs/transcripts/001.json"}]
    }
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path


def transcribe(job: dict, model: str, language: str, prompt: str | None, index: int, total: int) -> None:
    out = Path(job["out"])
    audio = Path(job["audio"])
    if out.exists():
        print(f"[{index}/{total}] cached {out.name}", flush=True)
        return
    if not audio.exists():
        raise SystemExit(f"audio file not found: {audio}")

    import mlx_whisper

    started = time.monotonic()
    result = mlx_whisper.transcribe(
        str(audio),
        path_or_hf_repo=model,
        language=language,
        initial_prompt=prompt,
        word_timestamps=True,
        condition_on_previous_text=False,
        # Drop suspected hallucinations that sit in long silences; they would
        # otherwise pull the alignment towards invented words.
        hallucination_silence_threshold=2.0,
        verbose=None,
    )

    words = []
    for segment in result.get("segments") or []:
        for word in segment.get("words") or []:
            text = word.get("word")
            start = word.get("start")
            end = word.get("end")
            if not isinstance(text, str) or not text.strip():
                continue
            if not isinstance(start, (int, float)) or not isinstance(end, (int, float)):
                continue
            words.append({"text": text, "start": float(start), "end": float(end)})

    out.parent.mkdir(parents=True, exist_ok=True)
    temporary = out.with_suffix(out.suffix + ".part")
    temporary.write_text(json.dumps({"words": words}, ensure_ascii=False), encoding="utf-8")
    os.replace(temporary, out)

    elapsed = time.monotonic() - started
    print(f"[{index}/{total}] {out.name}: {len(words)} words in {elapsed:.0f}s", flush=True)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("jobs", type=Path, help="job list written by `pnpm audiobook`")
    args = parser.parse_args()

    plan = json.loads(args.jobs.read_text(encoding="utf-8"))
    jobs = plan.get("jobs") or []
    if not jobs:
        print("no transcription jobs", file=sys.stderr)
        return 1

    for index, job in enumerate(jobs, start=1):
        transcribe(
            job,
            plan.get("model") or "mlx-community/whisper-large-v3-turbo",
            plan.get("language") or "es",
            plan.get("prompt"),
            index,
            len(jobs),
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
