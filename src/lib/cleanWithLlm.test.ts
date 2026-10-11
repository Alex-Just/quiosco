import { describe, expect, it, vi } from "vitest";
import {
  CLEANUP_SYSTEM_PROMPT,
  type CleanWithLlmOptions,
  cleanWithLlm,
} from "./cleanWithLlm";

const clean = (
  overrides: Omit<CleanWithLlmOptions, "translate"> & {
    translate: CleanWithLlmOptions["translate"];
  },
) => cleanWithLlm(overrides);

describe("cleanWithLlm", () => {
  it("returns the model output for a single segment", async () => {
    const translate = vi.fn(
      async (_request: { model: string; system: string; text: string }) =>
        "Texto limpio.",
    );
    const result = await clean({
      text: "Texto sucio con menú.",
      model: "m",
      translate,
    });
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
    const result = await clean({ text, model: "m", translate });
    expect(translate.mock.calls.length).toBeGreaterThan(1);
    expect(result.text.split("\n\n")).toHaveLength(translate.mock.calls.length);
    expect(result.cleaned).toBe(true);
  });

  it("falls back to the raw text when every call fails", async () => {
    const translate = vi.fn(async () => {
      throw new Error("boom");
    });
    const result = await clean({
      text: "Texto original.",
      model: "m",
      translate,
    });
    expect(result).toEqual({ text: "Texto original.", cleaned: false });
  });

  it("falls back to the raw text when the model returns empty output", async () => {
    const translate = vi.fn(async () => "   ");
    const result = await clean({
      text: "Texto original.",
      model: "m",
      translate,
    });
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
    const result = await clean({ text, model: "m", translate });
    expect(result.cleaned).toBe(false);
    expect(result.text).toContain("párrafo 1");
  });

  it("drops duplicate copies of the headline", async () => {
    const title = "Colombianos lideran el crisol inmigrante en Valencia";
    const translate = vi.fn(
      async (_request: { model: string; system: string; text: string }) =>
        `${title}\n\n${title}\n\nEl Ayuntamiento de Valencia notificó una población de 858.178 residentes.`,
    );
    const result = await clean({
      text: "cualquier cosa",
      model: "m",
      translate,
      title,
    });
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
      clean({
        text: "Texto sucio.",
        model: "m",
        translate,
        signal: controller.signal,
      }),
    ).rejects.toThrow("cancelled");
    expect(translate).not.toHaveBeenCalled();
  });

  it("reports progress as segments complete", async () => {
    const text = Array.from(
      { length: 3 },
      (_, index) => `párrafo ${index} ${"x".repeat(8000)}`,
    ).join("\n\n");
    const translate = vi.fn(async () => "ok");
    const seen: string[] = [];
    await clean({
      text,
      model: "m",
      translate,
      onProgress: (done, total) => {
        seen.push(`${done}/${total}`);
      },
    });
    expect(seen.sort()).toEqual(["1/3", "2/3", "3/3"]);
  });

  it("cleans segments in parallel", async () => {
    const text = Array.from(
      { length: 3 },
      (_, index) => `párrafo ${index} ${"x".repeat(8000)}`,
    ).join("\n\n");
    let active = 0;
    let maxActive = 0;
    const translate = vi.fn(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active -= 1;
      return "ok";
    });
    await clean({ text, model: "m", translate });
    expect(maxActive).toBeGreaterThan(1);
  });

  it("keeps segment order when responses arrive out of order", async () => {
    const text = Array.from(
      { length: 2 },
      (_, index) => `párrafo ${index} ${"x".repeat(8000)}`,
    ).join("\n\n");
    const translate = vi.fn(async (request: { text: string }) => {
      const first = request.text.startsWith("párrafo 0");
      if (first) await new Promise((resolve) => setTimeout(resolve, 30));
      return first ? "PRIMERO" : "SEGUNDO";
    });
    const result = await clean({ text, model: "m", translate });
    expect(result.text.indexOf("PRIMERO")).toBeLessThan(
      result.text.indexOf("SEGUNDO"),
    );
  });
});
