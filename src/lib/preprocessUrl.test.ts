// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "./api";
import { CLEANUP_NEED_QUESTION_ID } from "./needsCleanup";
import { preprocessUrlArticle } from "./preprocessUrl";

const paragraph = (n: number) =>
  `Párrafo ${n}: este es el contenido real del artículo, con longitud suficiente para contar como párrafo válido en la pasarela de calidad.`;

const goodHtml = `<html><head><title>Buen titular</title></head><body><article>${[
  0, 1, 2, 3, 4, 5,
]
  .map((n) => `<p>${paragraph(n)}</p>`)
  .join("\n")}</article></body></html>`;

describe("preprocessUrlArticle", () => {
  it("fetches via the ladder then suggests cleanup", async () => {
    const api = {
      fetchRung: vi.fn(async () => ({
        bytes: new TextEncoder().encode(goodHtml),
        contentType: "text/html; charset=utf-8",
        kind: "html" as const,
        via: "direct" as const,
        finalUrl: "https://example.com/a",
      })),
      decide: vi.fn(async () => ({
        answers: {
          [CLEANUP_NEED_QUESTION_ID]: { type: "noul", noul: 0.95 },
        },
      })),
    } as unknown as ApiClient;

    const details: string[] = [];
    const result = await preprocessUrlArticle("https://example.com/a", api, {
      sharedTitle: "",
      onDetail: (detail) => details.push(detail),
    });

    expect(result.via).toBe("direct");
    expect(result.needsCleanup).toBe(true);
    expect(result.text).toContain("Párrafo 0");
    expect(result.title).toBe("Buen titular");
    expect(api.fetchRung).toHaveBeenCalled();
    expect(api.decide).toHaveBeenCalled();
    expect(details.some((line) => line.includes("Checking"))).toBe(true);
  });
});
