// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { climbLadder, LadderError } from "./ladder";
import type { Rung, RungResponse } from "./types";

const paragraph = (n: number) =>
  `Párrafo ${n}: este es el contenido real del artículo, con longitud suficiente para contar como párrafo válido en la pasarela de calidad.`;

const goodHtml = `<html><head><title>Buen titular</title></head><body><article>${[
  0, 1, 2, 3, 4, 5,
]
  .map((n) => `<p>${paragraph(n)}</p>`)
  .join("\n")}</article></body></html>`;

const shortHtml = "<html><body><p>Teaser corto.</p></body></html>";

const htmlResponse = (html: string, via: Rung): RungResponse => ({
  bytes: new TextEncoder().encode(html),
  contentType: "text/html; charset=utf-8",
  kind: "html",
  via,
  finalUrl: "https://example.com/final",
});

describe("climbLadder", () => {
  it("escalates past a failing rung and records attempts", async () => {
    const fetchRung = async (rung: Rung): Promise<RungResponse> =>
      rung === "googlebot"
        ? htmlResponse(goodHtml, rung)
        : htmlResponse(shortHtml, rung);
    const result = await climbLadder("https://example.com/a", fetchRung);
    expect(result.via).toBe("googlebot");
    expect(result.article.title).toBe("Buen titular");
    expect(result.attempts.map((a) => a.rung)).toEqual(["direct", "googlebot"]);
    expect(result.attempts[0]).toMatchObject({
      ok: false,
      reason: "too-short",
    });
    expect(result.attempts[1]).toMatchObject({ ok: true });
  });

  it("supports the jina markdown rung and strips jina front matter", async () => {
    const markdown = `Title: Algo\n\nURL Source: https://example.com\n\nMarkdown Content: ${[
      0, 1, 2, 3, 4, 5,
    ]
      .map((n) => paragraph(n))
      .join("\n\n")}`;
    const fetchRung = async (rung: Rung): Promise<RungResponse> => {
      if (rung === "jina") {
        return {
          bytes: new TextEncoder().encode(markdown),
          contentType: "text/plain; charset=utf-8",
          kind: "markdown",
          via: rung,
          finalUrl: null,
        };
      }
      return htmlResponse(shortHtml, rung);
    };
    const result = await climbLadder("https://example.com/a", fetchRung);
    expect(result.via).toBe("jina");
    expect(result.article.text).toContain("Párrafo 0");
    expect(result.article.text).not.toContain("URL Source:");
  });

  it("throws LadderError with attempts and the longest partial text", async () => {
    const fetchRung = async (rung: Rung): Promise<RungResponse> =>
      rung === "direct"
        ? htmlResponse(
            `<html><body><p>${"x".repeat(900)}</p></body></html>`,
            rung,
          )
        : htmlResponse(shortHtml, rung);
    const error = await climbLadder("https://example.com/a", fetchRung).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(LadderError);
    const ladderError = error as LadderError;
    expect(ladderError.attempts).toHaveLength(5);
    expect(ladderError.partialText).toContain("xxxx");
  });

  it("records thrown errors as failed attempts", async () => {
    const fetchRung = async (): Promise<RungResponse> => {
      throw new Error("boom");
    };
    const error = (await climbLadder("https://example.com/a", fetchRung).catch(
      (e: unknown) => e,
    )) as LadderError;
    expect(
      error.attempts.every(
        (attempt) => !attempt.ok && attempt.reason === "boom",
      ),
    ).toBe(true);
  });
});
