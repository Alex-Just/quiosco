// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from "./settings";

describe("settings", () => {
  it("round-trips through storage", () => {
    saveSettings({
      ...DEFAULT_SETTINGS,
      targetLanguage: "Spanish",
      model: "big-pickle",
    });
    const loaded = loadSettings();
    expect(loaded.targetLanguage).toBe("Spanish");
    expect(loaded.model).toBe("big-pickle");
  });

  it("returns defaults for missing or corrupt data", () => {
    localStorage.clear();
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    localStorage.setItem("quiosco.settings.v1", "{oops");
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("merges partial data with defaults", () => {
    localStorage.setItem(
      "quiosco.settings.v1",
      JSON.stringify({ rules: "Be terse." }),
    );
    const loaded = loadSettings();
    expect(loaded.rules).toBe("Be terse.");
    expect(loaded.model).toBe(DEFAULT_SETTINGS.model);
    expect(loaded.autoTranslate).toBe(true);
  });
});
