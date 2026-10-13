import { afterEach, describe, expect, it, vi } from "vitest";
import { copyZenPageOriginal, ZEN_COPY_RESET_MS } from "./zenCopyActions";

describe("copyZenPageOriginal", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("writes the trimmed page text and flashes Copied briefly", async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    vi.useFakeTimers();
    const setCopied = vi.fn();

    await copyZenPageOriginal("  Hola página.  ", setCopied);

    expect(writeText).toHaveBeenCalledWith("Hola página.");
    expect(setCopied).toHaveBeenCalledWith(true);
    expect(ZEN_COPY_RESET_MS).toBe(1500);
    await vi.advanceTimersByTimeAsync(ZEN_COPY_RESET_MS);
    expect(setCopied).toHaveBeenCalledWith(false);
  });

  it("no-ops when there is nothing to copy", async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const setCopied = vi.fn();

    await copyZenPageOriginal("   ", setCopied);

    expect(writeText).not.toHaveBeenCalled();
    expect(setCopied).not.toHaveBeenCalled();
  });

  it("reports failure without flashing Copied", async () => {
    vi.stubGlobal("navigator", {
      clipboard: {
        writeText: vi.fn(async () => {
          throw new Error("denied");
        }),
      },
    });
    const setCopied = vi.fn();
    const setHint = vi.fn();

    await copyZenPageOriginal("Texto.", setCopied, setHint);

    expect(setCopied).not.toHaveBeenCalled();
    expect(setHint).toHaveBeenCalledWith("Could not copy the page.");
  });
});
