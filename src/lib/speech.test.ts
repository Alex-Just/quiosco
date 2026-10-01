import { describe, expect, it } from "vitest";
import { ORIGINAL_LANG, speechLangFor } from "./speech";

describe("speechLangFor", () => {
  it("maps the common target languages to BCP-47 codes", () => {
    expect(speechLangFor("English")).toBe("en-US");
    expect(speechLangFor("Spanish")).toBe("es-ES");
    expect(speechLangFor("español")).toBe("es-ES");
    expect(speechLangFor("French")).toBe("fr-FR");
  });

  it("is case-insensitive and trims whitespace", () => {
    expect(speechLangFor("  english ")).toBe("en-US");
  });

  it("returns an empty string for unknown languages", () => {
    expect(speechLangFor("Klingon")).toBe("");
  });

  it("exposes the original-article language", () => {
    expect(ORIGINAL_LANG).toBe("es-ES");
  });
});
