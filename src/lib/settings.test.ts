// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  applyRemoteSettings,
  clearSettingsDirty,
  DEFAULT_SETTINGS,
  isSettingsDirty,
  loadSettings,
  saveSettings,
} from "./settings";

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

  it("stamps updatedAt and marks dirty on save", () => {
    localStorage.clear();
    const before = Date.now();
    saveSettings({ ...DEFAULT_SETTINGS, model: "m" });
    const saved = loadSettings();
    expect(saved.updatedAt).toBeGreaterThanOrEqual(before);
    expect(isSettingsDirty()).toBe(true);
    clearSettingsDirty();
    expect(isSettingsDirty()).toBe(false);
  });

  it("applies newer remote settings, preserving the app token", () => {
    localStorage.clear();
    saveSettings({
      ...DEFAULT_SETTINGS,
      appToken: "local-token",
      model: "old",
    });
    const applied = applyRemoteSettings({
      updatedAt: Date.now() + 1000,
      data: JSON.stringify({ model: "new", targetLanguage: "French" }),
    });
    expect(applied?.model).toBe("new");
    expect(applied?.targetLanguage).toBe("French");
    expect(loadSettings().appToken).toBe("local-token");
  });

  it("ignores older remote settings", () => {
    localStorage.clear();
    saveSettings({ ...DEFAULT_SETTINGS, model: "keep" });
    const local = loadSettings();
    expect(
      applyRemoteSettings({
        updatedAt: 1,
        data: JSON.stringify({ model: "stale" }),
      }),
    ).toBeNull();
    expect(loadSettings().model).toBe(local.model);
  });
});
