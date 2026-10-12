import { describe, expect, it, vi } from "vitest";
import { applySharePrefillFields } from "./addPagePrefill";

describe("applySharePrefillFields", () => {
  it("clears a Chrome reader-mode garbage title so save can derive one", () => {
    const setTitle = vi.fn();
    const setUrl = vi.fn();
    const setText = vi.fn();
    const setCleanup = vi.fn();
    applySharePrefillFields(
      {
        nextTitle:
          "Including link: chrome-distiller://1712e844-db8f-4213-8dcb-ffe7c19a89ee/",
        nextUrl: "",
        nextBody: "La estación de metro con más viajeros en Valencia.",
        fromUrlShare: false,
      },
      { current: false },
      {
        setTitle,
        setUrl,
        setText,
        setCleanup,
        setFetchedVia: vi.fn(),
        setError: vi.fn(),
        setPreprocessing: vi.fn(),
        setFetchDetail: vi.fn(),
      },
    );
    expect(setTitle).toHaveBeenCalledWith("");
    expect(setText).toHaveBeenCalledWith(
      "La estación de metro con más viajeros en Valencia.",
    );
    expect(setCleanup).not.toHaveBeenCalled();
  });

  it("keeps a readable shared title", () => {
    const setTitle = vi.fn();
    applySharePrefillFields(
      {
        nextTitle: "Un titular",
        nextUrl: "",
        nextBody: "cuerpo",
        fromUrlShare: false,
      },
      { current: false },
      {
        setTitle,
        setUrl: vi.fn(),
        setText: vi.fn(),
        setCleanup: vi.fn(),
        setFetchedVia: vi.fn(),
        setError: vi.fn(),
        setPreprocessing: vi.fn(),
        setFetchDetail: vi.fn(),
      },
    );
    expect(setTitle).toHaveBeenCalledWith("Un titular");
  });
});
