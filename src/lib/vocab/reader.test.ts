import { describe, expect, it } from "vitest";
import {
  parseReaderListing,
  readerDownloadUrl,
  readerEntriesToWalk,
  readerFilesUrl,
} from "./reader";

describe("readerDownloadUrl", () => {
  it("points at the File Transfer download route", () => {
    expect(
      readerDownloadUrl("http://crosspoint.local", "/Vocabulary.txt"),
    ).toBe("http://crosspoint.local/download?path=%2FVocabulary.txt");
  });

  it("keeps a book path with spaces", () => {
    expect(
      readerDownloadUrl(
        "http://crosspoint.local/",
        "/Pushed Books/harry-potter-6-bilingual-v5.epub",
      ),
    ).toBe(
      "http://crosspoint.local/download?path=%2FPushed+Books%2Fharry-potter-6-bilingual-v5.epub",
    );
  });
});

describe("reader file listing", () => {
  it("asks for one directory", () => {
    expect(readerFilesUrl("http://crosspoint.local", "/Pushed Books")).toBe(
      "http://crosspoint.local/api/files?path=%2FPushed+Books",
    );
  });

  it("collects an epub in any folder and skips system folders", () => {
    const root = readerEntriesToWalk("/", [
      { name: "Books", size: 0, isDirectory: true, isEpub: false },
      { name: "XTCache", size: 0, isDirectory: true, isEpub: false },
      { name: ".crosspoint", size: 0, isDirectory: true, isEpub: false },
      { name: "Vocabulary.txt", size: 20, isDirectory: false, isEpub: false },
    ]);
    expect(root.directories).toEqual(["/Books"]);
    expect(root.epubs).toEqual([]);
    expect(
      readerEntriesToWalk("/Books", [
        {
          name: "001_alices_adventures_in_wonderland.epub",
          size: 70481,
          isDirectory: false,
          isEpub: true,
        },
      ]).epubs,
    ).toEqual([
      {
        path: "/Books/001_alices_adventures_in_wonderland.epub",
        size: 70481,
      },
    ]);
  });

  it("accepts a book whose flag is missing when the name ends in .epub", () => {
    const listing = parseReaderListing([
      { name: "story.epub", size: 10, isDirectory: false, isEpub: false },
      { name: "../escape.epub", size: 10, isDirectory: false, isEpub: true },
    ]);
    expect(listing.map((entry) => entry.name)).toEqual(["story.epub"]);
    expect(listing[0]?.isEpub).toBe(true);
  });
});
