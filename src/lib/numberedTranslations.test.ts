import { describe, expect, it } from "vitest";
import { parseNumberedTranslations } from "./numberedTranslations";

describe("parseNumberedTranslations", () => {
  it("parses the happy path and stops when the reply runs short", () => {
    expect(parseNumberedTranslations("1. Uno\n2. Dos", 3)).toEqual(
      new Map([
        [1, "Uno"],
        [2, "Dos"],
      ]),
    );
  });

  it("accepts both delimiters with padded whitespace", () => {
    expect(parseNumberedTranslations("  1.  Uno  \n\t2)  Dos  ", 2)).toEqual(
      new Map([
        [1, "Uno"],
        [2, "Dos"],
      ]),
    );
  });

  it("appends continuation lines to the current block", () => {
    const parsed = parseNumberedTranslations("1. Uno\ncontinuación\n2. Dos", 2);
    expect(parsed.get(1)).toBe("Uno continuación");
    expect(parsed.get(2)).toBe("Dos");
  });

  it("stops at a gap", () => {
    expect(parseNumberedTranslations("1. Uno\n3. Tres", 3)).toEqual(
      new Map([[1, "Uno"]]),
    );
  });

  it("stops at a duplicate", () => {
    expect(parseNumberedTranslations("1. Uno\n2. Dos\n2. Otra vez", 3)).toEqual(
      new Map([
        [1, "Uno"],
        [2, "Dos"],
      ]),
    );
  });

  it("stops at an out-of-range index", () => {
    expect(parseNumberedTranslations("1. Uno\n2. Dos\n3. Tres", 2)).toEqual(
      new Map([
        [1, "Uno"],
        [2, "Dos"],
      ]),
    );
  });

  it("stops at an empty block", () => {
    expect(parseNumberedTranslations("1. Uno\n2. \n3. Tres", 3)).toEqual(
      new Map([[1, "Uno"]]),
    );
  });

  it("ignores leading commentary", () => {
    const raw = "Aquí van las traducciones:\n\n1. Uno\n2. Dos";
    expect(parseNumberedTranslations(raw, 2)).toEqual(
      new Map([
        [1, "Uno"],
        [2, "Dos"],
      ]),
    );
  });

  it("drops trailing commentary after a blank line", () => {
    const raw = "1. Uno\n2. Dos\n\nEspero que sirva.";
    expect(parseNumberedTranslations(raw, 2)).toEqual(
      new Map([
        [1, "Uno"],
        [2, "Dos"],
      ]),
    );
  });

  it("ignores blank lines between earlier blocks", () => {
    const raw = "1. Uno\n\n2. Dos\n\n3. Tres";
    expect(parseNumberedTranslations(raw, 3)).toEqual(
      new Map([
        [1, "Uno"],
        [2, "Dos"],
        [3, "Tres"],
      ]),
    );
  });

  it("returns an empty Map when there are no numbered lines", () => {
    expect(parseNumberedTranslations("no numbered lines here", 3)).toEqual(
      new Map(),
    );
  });
});
