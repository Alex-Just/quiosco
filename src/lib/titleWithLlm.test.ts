import { describe, expect, it, vi } from "vitest";
import { extractTitleWithLlm, TITLE_SYSTEM_PROMPT } from "./titleWithLlm";

const article = `El Ayuntamiento de Valencia notificó el pasado mes de mayo al Instituto Nacional de Estadística una población de 858.178 residentes. El fenómeno de las migraciones ha sido decisivo los últimos lustros.`;

describe("extractTitleWithLlm", () => {
  it("returns the model's title, sanitized", async () => {
    const translate = vi.fn(
      async (_request: { model: string; system: string; text: string }) =>
        '"# Colombianos, ucranianos e italianos lideran el crisol inmigrante en Valencia."\n\nExtra commentary.',
    );
    const title = await extractTitleWithLlm(article, "m", translate);
    expect(title).toBe(
      "Colombianos, ucranianos e italianos lideran el crisol inmigrante en Valencia",
    );
    const request = translate.mock.calls[0]?.[0];
    expect(request?.system).toBe(TITLE_SYSTEM_PROMPT);
    expect(request?.model).toBe("m");
  });

  it("sends only the first 4000 characters", async () => {
    const translate = vi.fn(
      async (_request: { model: string; system: string; text: string }) =>
        "Un titular",
    );
    await extractTitleWithLlm("x".repeat(10_000), "m", translate);
    const request = translate.mock.calls[0]?.[0];
    expect(request?.text.length).toBe(4000);
  });

  it("returns null on failure", async () => {
    const translate = vi.fn(async () => {
      throw new Error("boom");
    });
    expect(await extractTitleWithLlm(article, "m", translate)).toBeNull();
  });

  it("returns null on empty output", async () => {
    const translate = vi.fn(async () => "   \n  ");
    expect(await extractTitleWithLlm(article, "m", translate)).toBeNull();
  });

  it("returns null for very short input", async () => {
    const translate = vi.fn(async () => "Un titular");
    expect(await extractTitleWithLlm("corto", "m", translate)).toBeNull();
    expect(translate).not.toHaveBeenCalled();
  });

  it("caps the title at 200 characters", async () => {
    const translate = vi.fn(async () => "Titular muy largo ".repeat(20));
    const title = await extractTitleWithLlm(article, "m", translate);
    expect(title?.length).toBe(200);
  });

  it("rejects URL-like garbage the model may echo", async () => {
    const translate = vi.fn(
      async () =>
        "Including link: chrome-distiller://4d67abef-fceb-4fe6-ba24-e052647073d4_6e7021b4f7948796fbd6c3443a0a9457241b0f45a77a2417652c9d223ba26076/",
    );
    expect(await extractTitleWithLlm(article, "m", translate)).toBeNull();
  });
});
