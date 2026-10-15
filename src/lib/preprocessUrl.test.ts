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

describe("preprocessUrlArticle threads", () => {
  const threadUrl = "https://x.com/RusiaSeMueve/status/2110631479294431539";
  const threadBody = {
    title: "Pedro Baños ha dedicado un video.",
    author: "Ricardo Marquina (@RusiaSeMueve)",
    text: "Pedro Baños ha dedicado un video.\n\nSegundo post.",
    tweetCount: 2,
    partial: false,
    source: "fxtwitter" as const,
  };

  it("fetches X threads before the ladder", async () => {
    const fetchRung = vi.fn();
    const decide = vi.fn();
    const fetchThread = vi.fn(async () => threadBody);
    const details: string[] = [];
    const result = await preprocessUrlArticle(
      threadUrl,
      {
        fetchRung,
        decide,
        fetchThread,
      } as unknown as ApiClient,
      { onDetail: (detail) => details.push(detail) },
    );

    expect(fetchThread).toHaveBeenCalledWith(threadUrl);
    expect(fetchRung).not.toHaveBeenCalled();
    expect(decide).not.toHaveBeenCalled();
    expect(result.via).toBe("twitter");
    expect(result.needsCleanup).toBe(false);
    expect(result.partial).toBe(false);
    expect(result.title).toBe("Pedro Baños ha dedicado un video.");
    expect(result.text).toBe(threadBody.text);
    expect(details).toContain("Fetching thread…");
  });

  it("passes the partial flag through", async () => {
    const result = await preprocessUrlArticle(threadUrl, {
      fetchRung: vi.fn(),
      decide: vi.fn(),
      fetchThread: vi.fn(async () => ({ ...threadBody, partial: true })),
    } as unknown as ApiClient);
    expect(result.partial).toBe(true);
  });

  it("keeps the ladder for lookalike hosts", async () => {
    const fetchRung = vi.fn(async () => ({
      bytes: new TextEncoder().encode(goodHtml),
      contentType: "text/html; charset=utf-8",
      kind: "html" as const,
      via: "direct" as const,
      finalUrl: "https://notx.com/a",
    }));
    const result = await preprocessUrlArticle(
      "https://notx.com/u/status/2110631479294431539",
      {
        fetchRung,
        decide: vi.fn(async () => ({ answers: {} })),
        fetchThread: vi.fn(),
      } as unknown as ApiClient,
    );
    expect(fetchRung).toHaveBeenCalled();
    expect(result.via).toBe("direct");
  });
});
