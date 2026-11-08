import { describe, expect, it } from "vitest";
import type { BookSentenceUnit } from "./bookText";
import {
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

const remote = (overrides: Partial<KosyncProgress> = {}): KosyncProgress => ({
  document: "0123456789abcdef0123456789abcdef",
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

describe("shouldPromptKosync", () => {
  const offsets = unitOffsets(units);

  it("offers a forward jump to a newer position", () => {
    expect(
      shouldPromptKosync({
        remote: remote(),
        offsets,
        localIndex: 0,
        dismissed: null,
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
      }),
    ).toBeNull();
    expect(
      shouldPromptKosync({
        remote: remote({ percentage: 0.1 }),
        offsets,
        localIndex: 2,
        dismissed: null,
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
      }),
    ).toBeNull();
  });

  it("suppresses the same remote push after dismissal", () => {
    const dismissed = {
      document: remote().document,
      updatedAt: remote().updatedAt,
    };
    expect(
      shouldPromptKosync({
        remote: remote(),
        offsets,
        localIndex: 0,
        dismissed,
      }),
    ).toBeNull();
    expect(
      shouldPromptKosync({
        remote: remote({ updatedAt: remote().updatedAt + 1 }),
        offsets,
        localIndex: 0,
        dismissed,
      }),
    ).not.toBeNull();
    expect(
      shouldPromptKosync({
        remote: remote({ document: "f".repeat(32) }),
        offsets,
        localIndex: 0,
        dismissed,
      }),
    ).not.toBeNull();
  });
});

describe("parseKosyncProgress", () => {
  it("accepts the lookup payload and clamps the percentage", () => {
    expect(
      parseKosyncProgress({
        document: remote().document,
        percentage: 1.4,
        progress: "56",
        device: " PocketBook ",
        updatedAt: 1_760_000_000,
        title: "El principito",
        authors: null,
      }),
    ).toMatchObject({
      document: remote().document,
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
    });
    expect(loadKosyncDismissal(store, "book-1")).toEqual({
      document: remote().document,
      updatedAt: remote().updatedAt,
    });

    store.setItem("quiosco.kosync.dismissed.book-2", "{");
    expect(loadKosyncDismissal(store, "book-2")).toBeNull();
    expect(loadKosyncDismissal(store, "missing")).toBeNull();
  });
});
