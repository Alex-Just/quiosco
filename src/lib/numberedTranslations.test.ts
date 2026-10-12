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

  it("keeps continuation lines on separate lines", () => {
    const parsed = parseNumberedTranslations("1. Uno\ncontinuación\n2. Dos", 2);
    expect(parsed.get(1)).toBe("Uno\ncontinuación");
    expect(parsed.get(2)).toBe("Dos");
  });

  it("parses the rules' sentence table: bare numbers with flag lines", () => {
    const raw = [
      "1  ",
      "🇪🇸 Su historia ha generado una ola de indignación.",
      "🇷🇺 Её история вызвала волну негодования.\t",
      "   ",
      "2",
      "🇪🇸 Otra frase del libro.",
      "🇷🇺 Другая фраза из книги.",
    ].join("\r\n");
    expect(parseNumberedTranslations(raw, 2)).toEqual(
      new Map([
        [
          1,
          "🇪🇸 Su historia ha generado una ola de indignación.\n🇷🇺 Её история вызвала волну негодования.",
        ],
        [2, "🇪🇸 Otra frase del libro.\n🇷🇺 Другая фраза из книги."],
      ]),
    );
  });

  it("stops the table prefix at a gap", () => {
    const raw = [
      "1",
      "🇪🇸 Uno.",
      "🇷🇺 Один.",
      "",
      "3",
      "🇪🇸 Tres.",
      "🇷🇺 Три.",
    ].join("\n");
    expect(parseNumberedTranslations(raw, 3)).toEqual(
      new Map([[1, "🇪🇸 Uno.\n🇷🇺 Один."]]),
    );
  });

  it("keeps a trailing marker without text out of the table", () => {
    const raw = ["1", "🇪🇸 Uno.", "🇷🇺 Один.", "", "2", ""].join("\n");
    expect(parseNumberedTranslations(raw, 2)).toEqual(
      new Map([[1, "🇪🇸 Uno.\n🇷🇺 Один."]]),
    );
  });

  it("files lines under the opener the reply provides and stops at a repeat", () => {
    // A model that opens "3" before finishing entry 2: the second "3"
    // repeats, so parsing stops. Entry 1 is complete, entry 2 keeps only the
    // line the model placed under it, and nothing past the repeat is cached.
    const raw = [
      "1",
      "🇪🇸 One.",
      "🇷🇺 Один.",
      "2",
      "🇪🇸 Two.",
      "3",
      "🇷🇺 Два.",
      "3",
      "🇪🇸 Tres.",
      "🇷🇺 Три.",
    ].join("\n");
    expect(parseNumberedTranslations(raw, 3)).toEqual(
      new Map([
        [1, "🇪🇸 One.\n🇷🇺 Один."],
        [2, "🇪🇸 Two."],
        [3, "🇷🇺 Два."],
      ]),
    );
  });

  it("breaks the prefix on a numeric line that is not the next opener", () => {
    const raw = ["1", "🇪🇸 Uno mil.", "2026", "🇷🇺 Один тысяча."].join("\n");
    expect(parseNumberedTranslations(raw, 1)).toEqual(
      new Map([[1, "🇪🇸 Uno mil."]]),
    );
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
