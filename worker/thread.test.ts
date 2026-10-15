import { describe, expect, it } from "vitest";
import { parseTweetStatusUrl } from "./thread";

describe("parseTweetStatusUrl", () => {
  const id = "2110631479294431539";

  it("extracts the id from the URL shapes X actually shares", () => {
    const urls = [
      `https://x.com/RusiaSeMueve/status/${id}`,
      `https://www.x.com/RusiaSeMueve/status/${id}`,
      `https://mobile.x.com/RusiaSeMueve/status/${id}`,
      `https://m.x.com/RusiaSeMueve/status/${id}`,
      `https://twitter.com/RusiaSeMueve/status/${id}`,
      `https://www.twitter.com/RusiaSeMueve/status/${id}`,
      `https://mobile.twitter.com/RusiaSeMueve/status/${id}`,
      `https://m.twitter.com/RusiaSeMueve/status/${id}`,
      `https://x.com/i/status/${id}`,
      `https://x.com/i/web/status/${id}`,
      `https://x.com/statuses/${id}`,
      `https://x.com/u/status/${id}?s=46&t=abc`,
      `https://x.com/u/status/${id}/photo/1`,
      `https://x.com/u/status/${id}/`,
    ];
    for (const url of urls) expect(parseTweetStatusUrl(url)).toBe(id);
  });

  it("keeps tiny legacy ids intact", () => {
    expect(parseTweetStatusUrl("http://x.com/u/status/20")).toBe("20");
  });

  it("returns null for everything else", () => {
    const rejected = [
      "https://x.com/RusiaSeMueve",
      "https://x.com/i/lists/1",
      "https://notx.com/u/status/12345678901234567890",
      "https://x.com.evil.com/u/status/12345678901234567890",
      "https://example.com/u/status/12345678901234567890",
      "ftp://x.com/u/status/123",
      "not a url",
      "javascript:alert(1)",
      "",
    ];
    for (const url of rejected) expect(parseTweetStatusUrl(url)).toBeNull();
  });
});
