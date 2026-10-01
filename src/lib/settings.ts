import type { Settings } from "./types";

const SETTINGS_KEY = "quiosco.settings.v1";

export const DEFAULT_SETTINGS: Settings = {
  targetLanguage: "English",
  rules: "",
  model: "glm-5.3-flash",
  appToken: "",
  autoTranslate: true,
};

export function loadSettings(
  storage: Pick<Storage, "getItem"> = localStorage,
): Settings {
  try {
    const raw = storage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      targetLanguage:
        typeof parsed.targetLanguage === "string"
          ? parsed.targetLanguage
          : DEFAULT_SETTINGS.targetLanguage,
      rules:
        typeof parsed.rules === "string"
          ? parsed.rules
          : DEFAULT_SETTINGS.rules,
      model:
        typeof parsed.model === "string" && parsed.model.trim()
          ? parsed.model
          : DEFAULT_SETTINGS.model,
      appToken:
        typeof parsed.appToken === "string"
          ? parsed.appToken
          : DEFAULT_SETTINGS.appToken,
      autoTranslate:
        typeof parsed.autoTranslate === "boolean"
          ? parsed.autoTranslate
          : DEFAULT_SETTINGS.autoTranslate,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(
  settings: Settings,
  storage: Pick<Storage, "setItem"> = localStorage,
): void {
  storage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}
