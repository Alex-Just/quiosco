import { describe, expect, it } from "vitest";
import { pairSourceWithTranslation } from "./zenTranslationDisplay";

describe("pairSourceWithTranslation", () => {
  it("prepends the source when the cache entry is translation-only", () => {
    expect(
      pairSourceWithTranslation(
        "—No seas idiota —dijo Sirius bruscamente.",
        "🇷🇺 — Не будь дураком, — резко сказал Сириус.",
      ),
    ).toBe(
      "🇪🇸 —No seas idiota —dijo Sirius bruscamente.\n🇷🇺 — Не будь дураком, — резко сказал Сириус.",
    );
  });

  it("leaves a complete bilingual entry alone", () => {
    const bilingual =
      "🇪🇸 ¿De verdad crees que Bagman creó la Marca Negra?\n🇷🇺 Неужели ты думаешь, что Чёрную Метку сотворил Бэгмен?";
    expect(
      pairSourceWithTranslation(
        "¿De verdad crees que Bagman creó la Marca Negra?",
        bilingual,
      ),
    ).toBe(bilingual);
  });

  it("does not duplicate when the entry is only the original", () => {
    expect(pairSourceWithTranslation("Hola mundo.", "🇪🇸 Hola mundo.")).toBe(
      "🇪🇸 Hola mundo.",
    );
  });

  it("returns the source when translation is empty or matches source", () => {
    expect(pairSourceWithTranslation("Solo el original.", "")).toBe(
      "Solo el original.",
    );
    expect(
      pairSourceWithTranslation("Solo el original.", "Solo el original."),
    ).toBe("Solo el original.");
  });

  it("leaves a plain (flagless) translation alone", () => {
    expect(pairSourceWithTranslation("Hola mundo.", "Hello world.")).toBe(
      "Hello world.",
    );
  });

  it("repairs OBJ on the translation line before pairing", () => {
    expect(
      pairSourceWithTranslation(
        "Crookshanks se subió.",
        "\uFFFCУ Живоглот забрался.",
      ),
    ).toBe("🇪🇸 Crookshanks se subió.\n🇷🇺 У Живоглот забрался.");
  });
});
