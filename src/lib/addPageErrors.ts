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
