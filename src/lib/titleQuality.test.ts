import { describe, expect, it } from "vitest";
import { isGarbageTitle } from "./titleQuality";

describe("isGarbageTitle", () => {
  it("flags Chrome reader-mode share artifacts", () => {
    expect(
      isGarbageTitle(
        "Including link: chrome-distiller://4d67abef-fceb-4fe6-ba24-e052647073d4_6e7021b4f7948796fbd6c3443a0a9457241b0f45a77a2417652c9d223ba26076/",
      ),
    ).toBe(true);
    expect(isGarbageTitle("Including link")).toBe(true);
  });

  it("flags URLs and long unbroken tokens", () => {
    expect(isGarbageTitle("https://elpais.com/noticia.html")).toBe(true);
    expect(isGarbageTitle("a".repeat(64))).toBe(true);
  });

  it("flags empty titles", () => {
    expect(isGarbageTitle("   ")).toBe(true);
  });

  it("accepts ordinary headlines", () => {
    expect(isGarbageTitle("El Gobierno aprueba nuevas medidas")).toBe(false);
    expect(isGarbageTitle("Última hora: dimite el ministro")).toBe(false);
    expect(isGarbageTitle("2-0: el Valencia golea en Mestalla")).toBe(false);
    expect(isGarbageTitle("Mestalla")).toBe(false);
  });
});
