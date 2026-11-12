import { describe, expect, it } from "vitest";
import {
  BILINGUAL_SIDECAR_PATH,
  buildBilingualSidecar,
  isBilingualSidecarPath,
  parseBilingualSidecar,
} from "./bilingual";

describe("bilingual sidecar", () => {
  it("round-trips the target language and pairs", () => {
    const book = {
      targetLanguage: "Russian",
      chapters: [
        { title: "Parte I", text: "" },
        { title: "Uno", text: "Hola." },
      ],
      entries: [{ source: "Hola.", translation: "🇪🇸 Hola.\n🇷🇺 Привет." }],
    };
    expect(parseBilingualSidecar(buildBilingualSidecar(book))).toEqual(book);
  });

  it("recognizes the sidecar path anywhere in the zip, any case", () => {
    expect(isBilingualSidecarPath(BILINGUAL_SIDECAR_PATH)).toBe(true);
    expect(isBilingualSidecarPath("OEBPS/QUIOSCO-BILINGUAL.JSON")).toBe(true);
    expect(isBilingualSidecarPath("OEBPS/other.json")).toBe(false);
  });

  it("drops empty entries and rejects malformed documents", () => {
    const valid = parseBilingualSidecar(
      JSON.stringify({
        version: 1,
        targetLanguage: "Russian",
        entries: [
          { source: "Hola.", translation: "Привет." },
          { source: " ", translation: " " },
        ],
      }),
    );
    expect(valid?.entries).toEqual([
      { source: "Hola.", translation: "Привет." },
    ]);

    expect(parseBilingualSidecar("not json")).toBeNull();
    expect(parseBilingualSidecar(JSON.stringify({ version: 2 }))).toBeNull();
    expect(
      parseBilingualSidecar(
        JSON.stringify({ version: 1, targetLanguage: "", entries: [] }),
      ),
    ).toBeNull();
  });
});
