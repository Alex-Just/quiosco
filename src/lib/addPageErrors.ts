import { EpubError } from "./epub/parseEpub";
import { LadderError } from "./ladder";

export function preprocessErrorMessage(error: unknown): string {
  if (error instanceof LadderError) {
    return "Could not extract the article from that URL — paste the text instead, or try again.";
  }
  if (error instanceof Error) return error.message;
  return "Fetch failed. Check your token and try again.";
}

export function saveErrorMessage(error: unknown): string {
  if (error instanceof LadderError) {
    return "Could not extract the article from that URL — paste the text instead.";
  }
  if (error instanceof Error) return error.message;
  return "save failed";
}

export const TOKEN_REQUIRED_FOR_URL =
  "Set your app token in Settings first — it is needed to fetch URLs.";

export function epubErrorMessage(error: unknown): string {
  if (error instanceof EpubError) {
    switch (error.code) {
      case "not-epub":
        return "This file doesn't look like an EPUB.";
      case "drm":
        return "This book is DRM-protected and can't be read here.";
      case "too-large":
        return error.detail === "text"
          ? "This book has more text than the reader supports."
          : "This book is too large to import.";
      case "empty":
        return "Could not read any text from this book.";
    }
  }
  return "Could not read that file.";
}

/**
 * Save failure in the book form: parser errors keep their code-mapped message,
 * everything else (e.g. a full store) is a save failure, not a read failure.
 */
export function bookSaveErrorMessage(error: unknown): string {
  if (error instanceof EpubError) return epubErrorMessage(error);
  return "Could not save the book.";
}
