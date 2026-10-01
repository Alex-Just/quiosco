import { describe, expect, it, vi } from "vitest";
import { CLEANUP_SYSTEM_PROMPT, cleanWithLlm } from "./cleanWithLlm";

describe("cleanWithLlm", () => {
  it("returns the model output for a single segment", async () => {
    const translate = vi.fn(
      async (_request: { model: string; system: string; text: string }) =>
        "Texto limpio.",
    );
    const result = await cleanWithLlm("Texto sucio con menú.", "m", translate);
    expect(result).toEqual({ text: "Texto limpio.", cleaned: true });
    expect(translate).toHaveBeenCalledTimes(1);
    const request = translate.mock.calls[0]?.[0];
    expect(request?.model).toBe("m");
    expect(request?.system).toBe(CLEANUP_SYSTEM_PROMPT);
  });

  it("cleans large texts segment by segment and joins with blank lines", async () => {
    const text = Array.from(
      { length: 3 },
      (_, index) => `párrafo ${index} ${"x".repeat(8000)}`,
    ).join("\n\n");
    const translate = vi.fn(
      async (request: { text: string }) => `C(${request.text.slice(0, 6)})`,
    );
    const result = await cleanWithLlm(text, "m", translate);
    expect(translate.mock.calls.length).toBeGreaterThan(1);
    expect(result.text.split("\n\n")).toHaveLength(translate.mock.calls.length);
    expect(result.cleaned).toBe(true);
  });

  it("falls back to the raw text when every call fails", async () => {
    const translate = vi.fn(async () => {
      throw new Error("boom");
    });
    const result = await cleanWithLlm("Texto original.", "m", translate);
    expect(result).toEqual({ text: "Texto original.", cleaned: false });
  });

  it("falls back to the raw text when the model returns empty output", async () => {
    const translate = vi.fn(async () => "   ");
    const result = await cleanWithLlm("Texto original.", "m", translate);
    expect(result).toEqual({ text: "Texto original.", cleaned: false });
  });

  it("does not mark a partially failed run as cleaned", async () => {
    const text = Array.from(
      { length: 3 },
      (_, index) => `párrafo ${index} ${"x".repeat(8000)}`,
    ).join("\n\n");
    let call = 0;
    const translate = vi.fn(async () => {
      call += 1;
      if (call === 2) throw new Error("boom");
      return "ok";
    });
    const result = await cleanWithLlm(text, "m", translate);
    expect(result.cleaned).toBe(false);
    expect(result.text).toContain("párrafo 1");
  });

  it("drops duplicate copies of the headline", async () => {
    const title = "Colombianos lideran el crisol inmigrante en Valencia";
    const translate = vi.fn(
      async (_request: { model: string; system: string; text: string }) =>
        `${title}\n\n${title}\n\nEl Ayuntamiento de Valencia notificó una población de 858.178 residentes.`,
    );
    const result = await cleanWithLlm("cualquier cosa", "m", translate, title);
    const copies = result.text
      .split(/\n{2,}/)
      .filter((block) => block.trim() === title);
    expect(copies).toHaveLength(1);
    expect(result.text).toContain("El Ayuntamiento de Valencia notificó");
  });

  it("stops immediately when the signal is already aborted", async () => {
    const translate = vi.fn(async () => "x");
    const controller = new AbortController();
    controller.abort();
    await expect(
      cleanWithLlm(
        "Texto sucio.",
        "m",
        translate,
        undefined,
        controller.signal,
      ),
    ).rejects.toThrow("cancelled");
    expect(translate).not.toHaveBeenCalled();
  });
});
