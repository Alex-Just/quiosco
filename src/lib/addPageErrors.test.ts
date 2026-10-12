import { describe, expect, it } from "vitest";
import { bookSaveErrorMessage, epubErrorMessage } from "./addPageErrors";
import { EpubError } from "./epub/parseEpub";

describe("epubErrorMessage", () => {
  it("maps not-epub to the file-format message", () => {
    expect(epubErrorMessage(new EpubError("not-epub"))).toBe(
      "This file doesn't look like an EPUB.",
    );
  });

  it("maps drm to the protection message", () => {
    expect(epubErrorMessage(new EpubError("drm"))).toBe(
      "This book is DRM-protected and can't be read here.",
    );
  });

  it("maps too-large to the size message", () => {
    expect(epubErrorMessage(new EpubError("too-large"))).toBe(
      "This book is too large to import.",
    );
  });

  it("maps too-large with the text detail to the text message", () => {
    expect(epubErrorMessage(new EpubError("too-large", "text"))).toBe(
      "This book has more text than the reader supports.",
    );
  });

  it("maps empty to the no-text message", () => {
    expect(epubErrorMessage(new EpubError("empty"))).toBe(
      "Could not read any text from this book.",
    );
  });

  it("maps a plain Error to the generic message", () => {
    expect(epubErrorMessage(new Error("boom"))).toBe(
      "Could not read that file.",
    );
  });

  it("maps a non-error value to the generic message", () => {
    expect(epubErrorMessage("nope")).toBe("Could not read that file.");
  });
});

describe("bookSaveErrorMessage", () => {
  it("keeps the parser message for an EpubError", () => {
    expect(bookSaveErrorMessage(new EpubError("too-large", "text"))).toBe(
      "This book has more text than the reader supports.",
    );
  });

  it("maps other save failures to the save message", () => {
    expect(bookSaveErrorMessage(new Error("QuotaExceededError"))).toBe(
      "Could not save the book.",
    );
    expect(bookSaveErrorMessage("nope")).toBe("Could not save the book.");
  });
});
