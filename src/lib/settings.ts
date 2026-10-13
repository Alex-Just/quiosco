import type { Settings, VoiceSetting } from "./types";

export const SETTINGS_KEY = "quiosco.settings.v1";
const SETTINGS_DIRTY_KEY = "quiosco.settings.dirty";
type SettingsStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const VOICE_SETTINGS = new Set<VoiceSetting>(["system", "elvira", "alvaro"]);
const DEFAULT_VOICE: VoiceSetting = "elvira";

function parseVoice(value: unknown): VoiceSetting {
  return typeof value === "string" && VOICE_SETTINGS.has(value as VoiceSetting)
    ? (value as VoiceSetting)
    : DEFAULT_VOICE;
}

export const DEFAULT_SETTINGS: Settings = {
  targetLanguage: "English",
  rules: "",
  model: "space-bunny-free",
  appToken: "",
  autoTranslate: true,
  voice: DEFAULT_VOICE,
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
      voice: parseVoice(parsed.voice),
      updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : 0,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(
  settings: Settings,
  storage: SettingsStorage = localStorage,
): void {
  storage.setItem(
    SETTINGS_KEY,
    JSON.stringify({ ...settings, updatedAt: Date.now() }),
  );
  storage.setItem(SETTINGS_DIRTY_KEY, "1");
}

export function isSettingsDirty(
  storage: Pick<Storage, "getItem"> = localStorage,
): boolean {
  return storage.getItem(SETTINGS_DIRTY_KEY) === "1";
}

export function clearSettingsDirty(
  storage: Pick<Storage, "removeItem"> = localStorage,
): void {
  storage.removeItem(SETTINGS_DIRTY_KEY);
}

const SYNCED_FIELDS = [
  "targetLanguage",
  "rules",
  "model",
  "autoTranslate",
  "voice",
] as const;

export function applyRemoteSettings(
  remote: { updatedAt: number; data: string },
  storage: SettingsStorage = localStorage,
): Settings | null {
  const current = loadSettings(storage);
  if (remote.updatedAt < (current.updatedAt ?? 0)) return null;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(remote.data) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object") return null;
  const next: Settings = { ...current, updatedAt: remote.updatedAt };
  for (const field of SYNCED_FIELDS) {
    const value = parsed[field];
    if (field === "autoTranslate") {
      if (typeof value === "boolean") next.autoTranslate = value;
    } else if (field === "voice") {
      if (
        typeof value === "string" &&
        VOICE_SETTINGS.has(value as VoiceSetting)
      ) {
        next.voice = value as VoiceSetting;
      }
    } else if (typeof value === "string") {
      next[field] = value;
    }
  }
  storage.setItem(SETTINGS_KEY, JSON.stringify(next));
  return next;
}
