import { describe, expect, it } from "vitest";
import { assessArticle, paragraphCount } from "./quality";

const para = (chars: number) => "x".repeat(chars);
const article = (paragraphs: string[]) => paragraphs.join("\n\n");

describe("paragraphCount", () => {
  it("counts only paragraphs of at least 40 chars", () => {
    expect(paragraphCount(article([para(120), "short", para(80)]))).toBe(2);
  });
});

describe("assessArticle", () => {
  it("passes a long multi-paragraph article", () => {
    expect(assessArticle(article([para(300), para(300), para(120)])).ok).toBe(
      true,
    );
  });

  it("rejects text under 600 chars", () => {
    expect(assessArticle(article([para(120), para(120), para(120)])).ok).toBe(
      false,
    );
    expect(assessArticle(article([para(120), para(120), para(120)]))).toEqual({
      ok: false,
      reason: "too-short",
    });
  });

  it("rejects fewer than 3 paragraphs", () => {
    const verdict = assessArticle(article([para(400), para(400)]));
    expect(verdict).toEqual({ ok: false, reason: "too-few-paragraphs" });
  });

  it("rejects paywall markers", () => {
    const text = article([
      para(300),
      para(300),
      para(300),
      "Suscríbete para seguir leyendo",
    ]);
    const verdict = assessArticle(text);
    expect(verdict).toEqual({ ok: false, reason: "marker" });
  });

  it("passes the boundary case of exactly 600 chars in 3 paragraphs", () => {
    expect(assessArticle(article([para(250), para(250), para(100)])).ok).toBe(
      true,
    );
  });
});
