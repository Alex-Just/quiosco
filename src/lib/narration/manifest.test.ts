import { describe, expect, it } from "vitest";
import { locateUnit, NarrationError, parseManifest } from "./manifest";

const chapter = {
  audio: "audio/001.ogg",
  duration: 12,
  starts: [0, 4],
  ends: [4, 12],
};

const manifest = {
  version: 1,
  title: "Libro",
  chapters: [chapter],
};

describe("parseManifest", () => {
  it("accepts a well-formed manifest", () => {
    expect(parseManifest(manifest)).toEqual(manifest);
  });

  it("rejects another format version", () => {
    expect(() => parseManifest({ ...manifest, version: 2 })).toThrow(
      NarrationError,
    );
  });

  it("rejects a manifest without chapters", () => {
    expect(() => parseManifest({ ...manifest, chapters: [] })).toThrow(
      NarrationError,
    );
  });

  it("rejects mismatched starts and ends", () => {
    expect(() =>
      parseManifest({
        ...manifest,
        chapters: [{ ...chapter, ends: [4] }],
      }),
    ).toThrow(/starts but 1 ends/);
  });

  it("rejects times that run backwards", () => {
    expect(() =>
      parseManifest({
        ...manifest,
        chapters: [{ ...chapter, starts: [0, 9, 4] }],
      }),
    ).toThrow(/backwards/);
  });

  it("rejects a unit that ends before it starts", () => {
    expect(() =>
      parseManifest({
        ...manifest,
        chapters: [{ ...chapter, starts: [4, 4], ends: [3, 12] }],
      }),
    ).toThrow(/ends before it starts/);
  });

  it("rejects a non-numeric time", () => {
    expect(() =>
      parseManifest({
        ...manifest,
        chapters: [{ ...chapter, starts: [0, "4"] }],
      }),
    ).toThrow(NarrationError);
  });

  it("drops nothing it does not understand", () => {
    const parsed = parseManifest({
      ...manifest,
      extra: "ignored",
      chapters: [{ ...chapter, note: "ignored" }],
    });
    expect(parsed).toEqual(manifest);
  });

  it("accepts a chapter the recording does not cover", () => {
    const parsed = parseManifest({
      ...manifest,
      chapters: [chapter, { audio: "", duration: 0, starts: [], ends: [] }],
    });
    expect(parsed.chapters[1]).toEqual({
      audio: "",
      duration: 0,
      starts: [],
      ends: [],
    });
  });

  it("rejects units on a chapter with no audio", () => {
    expect(() =>
      parseManifest({
        ...manifest,
        chapters: [{ audio: "", duration: 0, starts: [0], ends: [1] }],
      }),
    ).toThrow(/units without audio/);
  });
});

describe("locateUnit", () => {
  const firstUnits = [0, 10, 20, 20, 30];

  it("maps the first unit of a chapter", () => {
    expect(locateUnit(firstUnits, 0)).toEqual({ chapter: 0, local: 0 });
    expect(locateUnit(firstUnits, 10)).toEqual({ chapter: 1, local: 0 });
  });

  it("maps a unit inside a chapter", () => {
    expect(locateUnit(firstUnits, 15)).toEqual({ chapter: 1, local: 5 });
    expect(locateUnit(firstUnits, 34)).toEqual({ chapter: 4, local: 4 });
  });

  it("keeps an empty chapter from stealing its neighbour's units", () => {
    // Chapter 2 has no units, so index 20 belongs to chapter 3.
    expect(locateUnit(firstUnits, 20)).toEqual({ chapter: 3, local: 0 });
  });

  it("returns null outside the book", () => {
    expect(locateUnit([], 0)).toBeNull();
    expect(locateUnit(firstUnits, -1)).toBeNull();
  });
});
