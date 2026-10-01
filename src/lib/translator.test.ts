import { describe, expect, it, vi } from "vitest";
import { runTranslation, TranslationError } from "./translator";

const settings = {
  targetLanguage: "English",
  rules: "Be terse.",
  model: "deepseek-v4.1-flash",
};
const longText = (n: number) =>
  Array.from({ length: n }, (_, i) => `Frase número ${i}.`).join(" ");

describe("runTranslation", () => {
  it("translates a single chunk and reports progress", async () => {
    const onProgress = vi.fn();
    const result = await runTranslation({
      text: "Hola mundo.",
      settings,
      translate: async () => "Hello world.",
      onProgress,
    });
    expect(result.translation).toBe("Hello world.");
    expect(result.totalChunks).toBe(1);
    expect(onProgress).toHaveBeenCalledWith({
      translatedChunks: 1,
      totalChunks: 1,
      translation: "Hello world.",
    });
  });

  it("joins multiple chunks with a blank line", async () => {
    const translate = vi.fn(
      async (request: { text: string }) => `TR(${request.text.slice(0, 12)})`,
    );
    const result = await runTranslation({
      text: longText(4000),
      settings,
      translate,
    });
    expect(result.totalChunks).toBeGreaterThan(1);
    expect(result.translation.split("\n\n")).toHaveLength(result.totalChunks);
    expect(translate).toHaveBeenCalledTimes(result.totalChunks);
  });

  it("retries a chunk before failing", async () => {
    let call = 0;
    const translate = async () => {
      call += 1;
      if (call === 1) throw new Error("network");
      return "ok";
    };
    const result = await runTranslation({
      text: "Corto.",
      settings,
      translate,
      retries: 1,
    });
    expect(result.translation).toBe("ok");
    expect(call).toBe(2);
  });

  it("throws TranslationError with resume position when a chunk keeps failing", async () => {
    const translate = vi.fn(async (request: { text: string }) => {
      if (request.text.includes("segundo")) throw new Error("boom");
      return "primero";
    });
    const text = `${"primero ".repeat(1200)}\n\n${"segundo bloque ".repeat(500)}`;
    const error = (await runTranslation({
      text,
      settings,
      translate,
      retries: 0,
    }).catch((e: unknown) => e)) as TranslationError;
    expect(error).toBeInstanceOf(TranslationError);
    expect(error.translatedChunks).toBe(1);
    expect(error.totalChunks).toBe(2);
  });

  it("resumes from the stored chunk position", async () => {
    const translate = vi.fn(async () => "segunda parte");
    const text = `${"primero ".repeat(1200)}\n\n${"segundo ".repeat(1200)}`;
    const result = await runTranslation({
      text,
      settings,
      translate,
      existingTranslation: "primera parte",
      translatedChunks: 1,
    });
    expect(result.translation).toBe("primera parte\n\nsegunda parte");
    expect(translate).toHaveBeenCalledTimes(1);
  });

  it("does not re-translate when the progress callback fails", async () => {
    const translate = vi.fn(async () => "uno");
    const onProgress = vi.fn(async () => {
      throw new Error("persist failed");
    });
    await expect(
      runTranslation({ text: "Corto.", settings, translate, onProgress }),
    ).rejects.toThrow("persist failed");
    expect(translate).toHaveBeenCalledTimes(1);
  });

  it("stops immediately when the signal is already aborted", async () => {
    const translate = vi.fn(async () => "x");
    const controller = new AbortController();
    controller.abort();
    await expect(
      runTranslation({
        text: "Hola.",
        settings,
        translate,
        signal: controller.signal,
      }),
    ).rejects.toThrow("cancelled");
    expect(translate).not.toHaveBeenCalled();
  });
});
