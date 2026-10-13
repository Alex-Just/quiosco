import { describe, expect, it } from "vitest";
import {
  gapBeforeSentence,
  repairFlagMarkers,
  spaceFlagLines,
  startsWithFlag,
} from "./flagLines";

describe("startsWithFlag", () => {
  it("detects a leading flag", () => {
    expect(startsWithFlag("🇷🇺 Текст")).toBe(true);
    expect(startsWithFlag("  🇪🇸 Hola")).toBe(true);
    expect(startsWithFlag("Hola 🇪🇸")).toBe(false);
  });
});

describe("repairFlagMarkers", () => {
  it("replaces a leading object-replacement char with a Cyrillic flag", () => {
    expect(
      repairFlagMarkers("🇪🇸 Crookshanks se subió.\n\uFFFCУ Живоглот забрался."),
    ).toBe("🇪🇸 Crookshanks se subió.\n🇷🇺 У Живоглот забрался.");
  });

  it("completes a lone regional R before Cyrillic text", () => {
    expect(repairFlagMarkers("🇪🇸 Hola.\n🇷 Текст.")).toBe("🇪🇸 Hola.\n🇷🇺 Текст.");
  });

  it("leaves clean flag pairs and flagless Cyrillic alone", () => {
    expect(repairFlagMarkers("🇪🇸 Hola.\n🇷🇺 Привет.")).toBe(
      "🇪🇸 Hola.\n🇷🇺 Привет.",
    );
    expect(repairFlagMarkers("Просто текст без флага.")).toBe(
      "Просто текст без флага.",
    );
  });

  it("restores stanza spacing after repairing OBJ", () => {
    const repaired = repairFlagMarkers(
      "🇪🇸 Crookshanks se ovilló, ronroneando.\n\uFFFCУ Живоглот мурлыча.",
    );
    expect(startsWithFlag(repaired.split("\n")[1] ?? "")).toBe(true);
    expect(spaceFlagLines(repaired)).toBe(
      "🇪🇸 Crookshanks se ovilló, ronroneando.\n\n🇷🇺 У Живоглот мурлыча.",
    );
    expect(gapBeforeSentence("🇷🇺 У Живоглот мурлыча.")).toBe("\n\n");
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
    expect(spaceFlagLines("🇪🇸 ¿Dónde está Hagrid?\n🇷🇺 Где Хагрид?")).toBe(
      "🇪🇸 ¿Dónde está Hagrid?\n\n🇷🇺 Где Хагрид?",
    );
  });
});
