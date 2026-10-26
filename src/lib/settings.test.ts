// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  applyRemoteSettings,
  clearSettingsDirty,
  DEFAULT_SETTINGS,
  isSettingsDirty,
  loadSettings,
  migrateLegacyVoice,
  saveSettings,
} from "./settings";
import type { Settings } from "./types";

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

  it("defaults to Edge Elvira with an empty ElevenLabs voice id", () => {
    expect(DEFAULT_SETTINGS.ttsProvider).toBe("edge");
    expect(DEFAULT_SETTINGS.edgeVoice).toBe("elvira");
    expect(DEFAULT_SETTINGS.elevenLabsVoiceId).toBe("");
    localStorage.clear();
    expect(loadSettings().ttsProvider).toBe("edge");
  });

  it("defaults the speech rate to normal and clamps stored values", () => {
    expect(DEFAULT_SETTINGS.ttsRate).toBe(1);
    localStorage.clear();
    localStorage.setItem(
      "quiosco.settings.v1",
      JSON.stringify({ ttsRate: 1.5 }),
    );
    expect(loadSettings().ttsRate).toBe(1.5);
    localStorage.setItem("quiosco.settings.v1", JSON.stringify({ ttsRate: 9 }));
    expect(loadSettings().ttsRate).toBe(2);
    localStorage.setItem(
      "quiosco.settings.v1",
      JSON.stringify({ ttsRate: 0.1 }),
    );
    expect(loadSettings().ttsRate).toBe(0.5);
    localStorage.setItem(
      "quiosco.settings.v1",
      JSON.stringify({ ttsRate: "fast" }),
    );
    expect(loadSettings().ttsRate).toBe(1);
  });

  it("migrates legacy ttsRandom true into ttsProvider random", () => {
    expect(DEFAULT_SETTINGS.ttsProvider).toBe("edge");
    localStorage.clear();
    localStorage.setItem(
      "quiosco.settings.v1",
      JSON.stringify({ ttsProvider: "edge", ttsRandom: true }),
    );
    const loaded = loadSettings();
    expect(loaded.ttsProvider).toBe("random");
    expect(
      (loaded as Settings & { ttsRandom?: boolean }).ttsRandom,
    ).toBeUndefined();
  });

  it("loads a stored ttsProvider random", () => {
    localStorage.clear();
    localStorage.setItem(
      "quiosco.settings.v1",
      JSON.stringify({ ttsProvider: "random" }),
    );
    expect(loadSettings().ttsProvider).toBe("random");
  });

  it("returns defaults when no browser storage exists", () => {
    expect(loadSettings({ getItem: () => null })).toEqual(DEFAULT_SETTINGS);
  });

  it("migrates legacy flat voice values", () => {
    expect(migrateLegacyVoice("system")).toEqual({
      ttsProvider: "system",
      edgeVoice: "elvira",
    });
    expect(migrateLegacyVoice("alvaro")).toEqual({
      ttsProvider: "edge",
      edgeVoice: "alvaro",
    });
    expect(migrateLegacyVoice("elvira")).toEqual({
      ttsProvider: "edge",
      edgeVoice: "elvira",
    });
  });

  it("loads legacy voice from storage into the new shape", () => {
    localStorage.setItem(
      "quiosco.settings.v1",
      JSON.stringify({ voice: "alvaro" }),
    );
    const loaded = loadSettings();
    expect(loaded.ttsProvider).toBe("edge");
    expect(loaded.edgeVoice).toBe("alvaro");
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
    expect(loaded.ttsProvider).toBe("edge");
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

  it("merges remote ttsProvider and elevenLabsVoiceId", () => {
    localStorage.clear();
    saveSettings({
      ...DEFAULT_SETTINGS,
      ttsProvider: "system",
      appToken: "t",
    });
    const applied = applyRemoteSettings({
      updatedAt: Date.now() + 1000,
      data: JSON.stringify({
        ttsProvider: "elevenlabs",
        elevenLabsVoiceId: "voice-abc",
        ttsRate: 1.5,
      }),
    });
    expect(applied?.ttsProvider).toBe("elevenlabs");
    expect(applied?.elevenLabsVoiceId).toBe("voice-abc");
    expect(applied?.ttsRate).toBe(1.5);
    expect(loadSettings().appToken).toBe("t");
  });

  it("migrates remote legacy ttsRandom into ttsProvider random", () => {
    localStorage.clear();
    saveSettings({ ...DEFAULT_SETTINGS, appToken: "t" });
    const applied = applyRemoteSettings({
      updatedAt: Date.now() + 1000,
      data: JSON.stringify({
        ttsProvider: "elevenlabs",
        elevenLabsVoiceId: "voice-abc",
        ttsRandom: true,
      }),
    });
    expect(applied?.ttsProvider).toBe("random");
    expect(applied?.elevenLabsVoiceId).toBe("voice-abc");
  });

  it("migrates remote legacy voice when new fields are absent", () => {
    localStorage.clear();
    saveSettings({ ...DEFAULT_SETTINGS, appToken: "t" });
    const applied = applyRemoteSettings({
      updatedAt: Date.now() + 1000,
      data: JSON.stringify({ voice: "system" }),
    });
    expect(applied?.ttsProvider).toBe("system");
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

  it("ignores remote data that is not an object", () => {
    localStorage.clear();
    saveSettings({ ...DEFAULT_SETTINGS, model: "keep" });
    const before = loadSettings();
    expect(
      applyRemoteSettings({ updatedAt: Date.now(), data: "null" }),
    ).toBeNull();
    expect(loadSettings()).toEqual(before);
  });
});
