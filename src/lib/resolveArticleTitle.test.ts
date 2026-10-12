import { describe, expect, it, vi } from "vitest";
import { resolveArticleTitle } from "./resolveArticleTitle";

const BODY = `La estación de metro con más viajeros en Valencia: más de 500.000 pasajeros en un mes

Nacho Ortega

Valencia 11/10/2026 Actualizado a las 00:07h.

El resto del artículo sigue aquí con más contexto sobre el tráfico de viajeros.`;

const GARBAGE =
  "Including link: chrome-distiller://1712e844-db8f-4213-8dcb-ffe7c19a89ee_b7ba30d124a13e87d65775d682e8be97d08a329e02b23cfd4496b91173822fa0/";

describe("resolveArticleTitle", () => {
  it("keeps a good provided title", async () => {
    const title = await resolveArticleTitle({
      title: "Un titular bueno",
      extractedTitle: null,
      body: BODY,
      url: null,
    });
    expect(title).toBe("Un titular bueno");
  });

  it("rejects a Chrome reader share title and uses the LLM guess", async () => {
    const guessWithLlm = vi.fn(async () => "Titular del modelo");
    const title = await resolveArticleTitle({
      title: GARBAGE,
      extractedTitle: null,
      body: BODY,
      url: null,
      guessWithLlm,
    });
    expect(guessWithLlm).toHaveBeenCalledWith(BODY);
    expect(title).toBe("Titular del modelo");
  });

  it("falls back to the first meaningful body line when the LLM is absent", async () => {
    const title = await resolveArticleTitle({
      title: GARBAGE,
      extractedTitle: null,
      body: BODY,
      url: null,
    });
    expect(title).toBe(
      "La estación de metro con más viajeros en Valencia: más de 500.000 pasajeros en un mes",
    );
  });

  it("falls back to the first meaningful body line when the LLM returns null", async () => {
    const title = await resolveArticleTitle({
      title: GARBAGE,
      extractedTitle: null,
      body: BODY,
      url: null,
      guessWithLlm: async () => null,
    });
    expect(title).toBe(
      "La estación de metro con más viajeros en Valencia: más de 500.000 pasajeros en un mes",
    );
  });

  it("prefers a non-garbage extracted title over a garbage shared title", async () => {
    const title = await resolveArticleTitle({
      title: GARBAGE,
      extractedTitle: "Titular extraído",
      body: BODY,
      url: null,
    });
    expect(title).toBe("Titular extraído");
  });

  it("skips a garbage extracted title and uses the body", async () => {
    const title = await resolveArticleTitle({
      title: "",
      extractedTitle: "https://elpais.com/a.html",
      body: BODY,
      url: null,
    });
    expect(title).toBe(
      "La estación de metro con más viajeros en Valencia: más de 500.000 pasajeros en un mes",
    );
  });
});
