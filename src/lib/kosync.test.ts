import { describe, expect, it } from "vitest";
import type { BookSentenceUnit } from "./bookText";
import {
  bilingualXPointer,
  bilingualXPointerUnitIndex,
  KOSYNC_MAPPING_VERSION,
  loadKosyncDismissal,
  parseKosyncProgress,
  saveKosyncDismissal,
  shouldPromptKosync,
  unitIndexAtPercentage,
  unitOffsets,
} from "./kosync";
import type { KosyncProgress } from "./types";

const units: BookSentenceUnit[] = [
  { paragraphIndex: 0, text: "aaaa", skipped: false },
  { paragraphIndex: 0, text: "bbbb", skipped: false },
  { paragraphIndex: 1, text: "cccc", skipped: false },
];

/** Two chapters with a title unit each, then two body units each. */
const chapteredUnits: BookSentenceUnit[] = [
  { paragraphIndex: 0, text: "Uno", skipped: false },
  { paragraphIndex: 1, text: "Uno a", skipped: false },
  { paragraphIndex: 1, text: "Uno b", skipped: false },
  { paragraphIndex: 2, text: "Dos", skipped: false },
  { paragraphIndex: 3, text: "Dos a", skipped: false },
  { paragraphIndex: 3, text: "Dos b", skipped: false },
];

/** First body units: chapter 1 starts at 1, chapter 2 at 4. */
const chapterBodyStarts = [1, 4];

const remote = (overrides: Partial<KosyncProgress> = {}): KosyncProgress => ({
  document: "0123456789abcdef0123456789abcdef",
  filename: null,
  percentage: 0.75,
  progress: "/body/DocFragment[2]/body/p[1]/text().4",
  device: "PocketBook",
  updatedAt: 1_760_000_000,
  title: "El principito",
  authors: "Antoine de Saint-Exupéry",
  ...overrides,
});

function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

describe("unitOffsets", () => {
  it("records character starts and the total", () => {
    expect(unitOffsets(units)).toEqual({
      starts: [0, 4, 8],
      total: 12,
    });
  });

  it("handles no units", () => {
    expect(unitOffsets([])).toEqual({ starts: [], total: 0 });
  });
});

describe("unitIndexAtPercentage", () => {
  const offsets = unitOffsets(units);

  it("maps the boundaries to the expected unit", () => {
    expect(unitIndexAtPercentage(offsets, 0)).toBe(0);
    expect(unitIndexAtPercentage(offsets, 0.33)).toBe(0);
    expect(unitIndexAtPercentage(offsets, 0.5)).toBe(1);
    expect(unitIndexAtPercentage(offsets, 1)).toBe(2);
  });

  it("clamps out-of-range values and rejects unusable offsets", () => {
    expect(unitIndexAtPercentage(offsets, -1)).toBe(0);
    expect(unitIndexAtPercentage(offsets, 2)).toBe(2);
    expect(unitIndexAtPercentage(offsets, Number.NaN)).toBeNull();
    expect(unitIndexAtPercentage(unitOffsets([]), 0.5)).toBeNull();
  });
});

describe("bilingualXPointerUnitIndex", () => {
  const index = (
    progress: string,
    filename: string | null = "libro-bilingual.epub",
  ) =>
    bilingualXPointerUnitIndex({
      progress,
      filename,
      chapterBodyStarts,
      unitCount: chapteredUnits.length,
    });

  it("maps the export's chapter and p index to a body unit", () => {
    expect(index("/body/DocFragment[2]/body/p[1]/br[1].0")).toBe(4);
    expect(index("/body/DocFragment[2]/body/p[2]/br[1].0")).toBe(5);
    expect(index("/body/DocFragment[1]/body/p[2]/br[1].0")).toBe(2);
  });

  it("rejects out-of-range, non-export, and non-bilingual inputs", () => {
    expect(index("/body/DocFragment[2]/body/p[3]/br[1].0")).toBeNull();
    expect(index("/body/DocFragment[3]/body/p[1]/br[1].0")).toBeNull();
    expect(index("/body/DocFragment[2]/body/p[1]/text().0")).toBeNull();
    expect(
      index("/body/DocFragment[2]/body/p[1]/br[1].0", "libro.epub"),
    ).toBeNull();
    expect(index("/body/DocFragment[2]/body/p[1]/br[1].0", null)).toBeNull();
  });
});

describe("bilingualXPointer", () => {
  const chapterUnitStarts = [0, 3];
  const pointer = (
    index: number,
    starts: readonly number[] = chapterBodyStarts,
  ) =>
    bilingualXPointer({
      index,
      chapterUnitStarts,
      chapterBodyStarts: starts,
      unitCount: chapteredUnits.length,
    });

  it("maps a body unit back to the export's chapter and p index", () => {
    expect(pointer(1)).toBe("/body/DocFragment[1]/body/p[1]/br[1].0");
    expect(pointer(2)).toBe("/body/DocFragment[1]/body/p[2]/br[1].0");
    expect(pointer(4)).toBe("/body/DocFragment[2]/body/p[1]/br[1].0");
    expect(pointer(5)).toBe("/body/DocFragment[2]/body/p[2]/br[1].0");
  });

  it("round-trips through the reader's mapper", () => {
    for (const index of [1, 2, 4, 5]) {
      const progress = pointer(index) as string;
      expect(
        bilingualXPointerUnitIndex({
          progress,
          filename: "libro-bilingual.epub",
          chapterBodyStarts,
          unitCount: chapteredUnits.length,
        }),
      ).toBe(index);
    }
  });

  it("rejects title units, out-of-range indexes, and chapterless books", () => {
    expect(pointer(0)).toBeNull();
    expect(pointer(3)).toBeNull();
    expect(pointer(6)).toBeNull();
    expect(pointer(-1)).toBeNull();
    expect(pointer(1.5)).toBeNull();
    expect(pointer(1, [])).toBeNull();
  });
});

describe("shouldPromptKosync", () => {
  const offsets = unitOffsets(units);
  const chapteredOffsets = unitOffsets(chapteredUnits);

  it("offers a forward jump to a newer position", () => {
    expect(
      shouldPromptKosync({
        remote: remote(),
        offsets,
        localIndex: 0,
        dismissed: null,
        chapterBodyStarts: [],
      }),
    ).toMatchObject({
      index: 2,
      percentage: 0.75,
      device: "PocketBook",
    });
  });

  it("does not prompt when the remote is at or behind the local unit", () => {
    expect(
      shouldPromptKosync({
        remote: remote({ percentage: 0.5 }),
        offsets,
        localIndex: 1,
        dismissed: null,
        chapterBodyStarts: [],
      }),
    ).toBeNull();
    expect(
      shouldPromptKosync({
        remote: remote({ percentage: 0.1 }),
        offsets,
        localIndex: 2,
        dismissed: null,
        chapterBodyStarts: [],
      }),
    ).toBeNull();
  });

  it("does not prompt for a negligible fraction of a unit", () => {
    expect(
      shouldPromptKosync({
        remote: remote({ percentage: 0.01 }),
        offsets,
        localIndex: 0,
        dismissed: null,
        chapterBodyStarts: [],
      }),
    ).toBeNull();
  });

  it("uses the exact bilingual XPointer over the percentage", () => {
    expect(
      shouldPromptKosync({
        remote: remote({
          filename: "libro-bilingual.epub",
          percentage: 0.95,
          progress: "/body/DocFragment[2]/body/p[1]/br[1].0",
        }),
        offsets: chapteredOffsets,
        localIndex: 0,
        dismissed: null,
        chapterBodyStarts,
      }),
    ).toMatchObject({ index: 4 });
  });

  it("offers an exact bilingual correction behind the local unit", () => {
    expect(
      shouldPromptKosync({
        remote: remote({
          filename: "libro-bilingual.epub",
          percentage: 0.65,
          progress: "/body/DocFragment[2]/body/p[1]/br[1].0",
        }),
        offsets: chapteredOffsets,
        localIndex: 5,
        dismissed: null,
        chapterBodyStarts,
      }),
    ).toMatchObject({ index: 4 });
  });

  it("suppresses the same remote push after dismissal", () => {
    const dismissed = {
      document: remote().document,
      updatedAt: remote().updatedAt,
      version: KOSYNC_MAPPING_VERSION,
    };
    expect(
      shouldPromptKosync({
        remote: remote(),
        offsets,
        localIndex: 0,
        dismissed,
        chapterBodyStarts: [],
      }),
    ).toBeNull();
    expect(
      shouldPromptKosync({
        remote: remote({ updatedAt: remote().updatedAt + 1 }),
        offsets,
        localIndex: 0,
        dismissed,
        chapterBodyStarts: [],
      }),
    ).not.toBeNull();
    expect(
      shouldPromptKosync({
        remote: remote({ document: "f".repeat(32) }),
        offsets,
        localIndex: 0,
        dismissed,
        chapterBodyStarts: [],
      }),
    ).not.toBeNull();
  });

  it("ignores a dismissal from an older mapping version", () => {
    expect(
      shouldPromptKosync({
        remote: remote(),
        offsets,
        localIndex: 0,
        dismissed: {
          document: remote().document,
          updatedAt: remote().updatedAt,
          version: KOSYNC_MAPPING_VERSION - 1,
        },
        chapterBodyStarts: [],
      }),
    ).not.toBeNull();
  });
});

describe("parseKosyncProgress", () => {
  it("accepts the lookup payload and clamps the percentage", () => {
    expect(
      parseKosyncProgress({
        document: remote().document,
        filename: "libro-bilingual.epub",
        percentage: 1.4,
        progress: "56",
        device: " PocketBook ",
        updatedAt: 1_760_000_000,
        title: "El principito",
        authors: null,
      }),
    ).toMatchObject({
      document: remote().document,
      filename: "libro-bilingual.epub",
      percentage: 1,
      device: "PocketBook",
      title: "El principito",
      authors: null,
    });
  });

  it("rejects malformed payloads", () => {
    for (const value of [
      null,
      [],
      {},
      { ...remote(), document: "" },
      { ...remote(), percentage: "0.5" },
      { ...remote(), progress: 56 },
      { ...remote(), device: 1 },
      { ...remote(), updatedAt: Number.NaN },
    ]) {
      expect(parseKosyncProgress(value)).toBeNull();
    }
  });
});

describe("kosync dismissal storage", () => {
  it("round-trips a dismissal and ignores corrupt entries", () => {
    const store = storage();
    saveKosyncDismissal(store, "book-1", {
      document: remote().document,
      updatedAt: remote().updatedAt,
      version: KOSYNC_MAPPING_VERSION,
    });
    expect(loadKosyncDismissal(store, "book-1")).toEqual({
      document: remote().document,
      updatedAt: remote().updatedAt,
      version: KOSYNC_MAPPING_VERSION,
    });

    store.setItem("quiosco.kosync.dismissed.book-2", "{");
    expect(loadKosyncDismissal(store, "book-2")).toBeNull();
    expect(loadKosyncDismissal(store, "missing")).toBeNull();
  });

  it("loads a legacy dismissal as version 0 so the new mapping can prompt", () => {
    const store = storage();
    store.setItem(
      "quiosco.kosync.dismissed.book-3",
      JSON.stringify({
        document: remote().document,
        updatedAt: remote().updatedAt,
      }),
    );
    expect(loadKosyncDismissal(store, "book-3")?.version).toBe(0);
  });
});
