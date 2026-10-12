import { describe, expect, it } from "vitest";
import { gapBeforeSentence, spaceFlagLines, startsWithFlag } from "./flagLines";

describe("startsWithFlag", () => {
  it("detects a leading flag", () => {
    expect(startsWithFlag("🇷🇺 Текст")).toBe(true);
    expect(startsWithFlag("  🇪🇸 Hola")).toBe(true);
    expect(startsWithFlag("Hola 🇪🇸")).toBe(false);
  });
});

describe("spaceFlagLines", () => {
  it("inserts a blank line before a following flag line", () => {
    expect(
      spaceFlagLines(
        '🇪🇸 Trump afirma que hay un "alto el fuego".\n🇷🇺 Трамп заявляет.',
      ),
    ).toBe('🇪🇸 Trump afirma que hay un "alto el fuego".\n\n🇷🇺 Трамп заявляет.');
  });

  it("splits a flag that was glued on the same line", () => {
    expect(spaceFlagLines("🇪🇸 Hola mundo. 🇷🇺 Привет.")).toBe(
      "🇪🇸 Hola mundo.\n\n🇷🇺 Привет.",
    );
  });
});

describe("gapBeforeSentence", () => {
  it("uses a blank line before a flag-led sentence", () => {
    expect(gapBeforeSentence("🇷🇺 Текст.")).toBe("\n\n");
    expect(gapBeforeSentence("Sigue el párrafo.")).toBe(" ");
  });

  it("keeps a blank line before a flag after a Spanish question", () => {
    // Regression: ¿…? used to break layout when this gap lived inside the
    // previous inline sentence button; the gap string itself must stay blank.
    expect(gapBeforeSentence("🇷🇺 Где Хагрид?")).toBe("\n\n");
    expect(
      spaceFlagLines("🇪🇸 ¿Dónde está Hagrid?\n🇷🇺 Где Хагрид?"),
    ).toBe("🇪🇸 ¿Dónde está Hagrid?\n\n🇷🇺 Где Хагрид?");
  });
});
