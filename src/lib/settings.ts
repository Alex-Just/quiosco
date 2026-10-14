import type {
  EdgeVoiceSetting,
  Settings,
  TtsProvider,
  VoiceSetting,
} from "./types";

export const SETTINGS_KEY = "quiosco.settings.v1";
const SETTINGS_DIRTY_KEY = "quiosco.settings.dirty";
type SettingsStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const TTS_PROVIDERS = new Set<TtsProvider>(["system", "edge", "elevenlabs"]);
const EDGE_VOICES = new Set<EdgeVoiceSetting>(["elvira", "alvaro"]);
const DEFAULT_PROVIDER: TtsProvider = "edge";
const DEFAULT_EDGE_VOICE: EdgeVoiceSetting = "elvira";

/** Speech rate multiplier bounds shared by every TTS provider. */
export const TTS_RATE_MIN = 0.5;
export const TTS_RATE_MAX = 2;
export const DEFAULT_TTS_RATE = 1;

function parseProvider(value: unknown): TtsProvider {
  return typeof value === "string" && TTS_PROVIDERS.has(value as TtsProvider)
    ? (value as TtsProvider)
    : DEFAULT_PROVIDER;
}

function parseEdgeVoice(value: unknown): EdgeVoiceSetting {
  return typeof value === "string" && EDGE_VOICES.has(value as EdgeVoiceSetting)
    ? (value as EdgeVoiceSetting)
    : DEFAULT_EDGE_VOICE;
}

/** Clamp any usable rate into the supported range; normal for anything else. */
export function parseTtsRate(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_TTS_RATE;
  }
  return Math.min(TTS_RATE_MAX, Math.max(TTS_RATE_MIN, value));
}

/** Map the legacy flat `voice` field into provider + edgeVoice. */
export function migrateLegacyVoice(voice: unknown): {
  ttsProvider: TtsProvider;
  edgeVoice: EdgeVoiceSetting;
} {
  if (voice === "system") {
    return { ttsProvider: "system", edgeVoice: DEFAULT_EDGE_VOICE };
  }
  if (voice === "alvaro") {
    return { ttsProvider: "edge", edgeVoice: "alvaro" };
  }
  if (voice === "elvira") {
    return { ttsProvider: "edge", edgeVoice: "elvira" };
  }
  return { ttsProvider: DEFAULT_PROVIDER, edgeVoice: DEFAULT_EDGE_VOICE };
}

export const DEFAULT_SETTINGS: Settings = {
  targetLanguage: "English",
  rules: "",
  model: "space-bunny-free",
  appToken: "",
  autoTranslate: true,
  ttsProvider: DEFAULT_PROVIDER,
  edgeVoice: DEFAULT_EDGE_VOICE,
  elevenLabsVoiceId: "",
  ttsRate: DEFAULT_TTS_RATE,
  ttsRandom: false,
};

/**
 * Resolve browser storage without a bare `localStorage` identifier.
 * Node CI has no localStorage; a default parameter of `= localStorage`
 * throws ReferenceError before the function body runs.
 */
function resolveStorage(): SettingsStorage | null {
  try {
    const storage = globalThis.localStorage;
    return storage ?? null;
  } catch {
    return null;
  }
}

const MEMORY_STORAGE = (): SettingsStorage => {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
};

function settingsFromPartial(
  parsed: Partial<Settings> & { voice?: unknown },
): Settings {
  const hasNewShape =
    typeof parsed.ttsProvider === "string" ||
    typeof parsed.edgeVoice === "string" ||
    typeof parsed.elevenLabsVoiceId === "string";
  const migrated = hasNewShape
    ? {
        ttsProvider: parseProvider(parsed.ttsProvider),
        edgeVoice: parseEdgeVoice(parsed.edgeVoice),
      }
    : migrateLegacyVoice(parsed.voice);

  return {
    targetLanguage:
      typeof parsed.targetLanguage === "string"
        ? parsed.targetLanguage
        : DEFAULT_SETTINGS.targetLanguage,
    rules:
      typeof parsed.rules === "string" ? parsed.rules : DEFAULT_SETTINGS.rules,
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
    ttsProvider: migrated.ttsProvider,
    edgeVoice: migrated.edgeVoice,
    elevenLabsVoiceId:
      typeof parsed.elevenLabsVoiceId === "string"
        ? parsed.elevenLabsVoiceId
        : DEFAULT_SETTINGS.elevenLabsVoiceId,
    ttsRate: parseTtsRate(parsed.ttsRate),
    ttsRandom:
      typeof parsed.ttsRandom === "boolean"
        ? parsed.ttsRandom
        : DEFAULT_SETTINGS.ttsRandom,
    updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : 0,
  };
}

export function loadSettings(storage?: Pick<Storage, "getItem">): Settings {
  const store = storage ?? resolveStorage();
  if (!store) return { ...DEFAULT_SETTINGS };
  try {
    const raw = store.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<Settings> & { voice?: unknown };
    return settingsFromPartial(parsed);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(
  settings: Settings,
  storage: SettingsStorage = resolveStorage() ?? MEMORY_STORAGE(),
): void {
  storage.setItem(
    SETTINGS_KEY,
    JSON.stringify({ ...settings, updatedAt: Date.now() }),
  );
  storage.setItem(SETTINGS_DIRTY_KEY, "1");
}

export function isSettingsDirty(storage?: Pick<Storage, "getItem">): boolean {
  const store = storage ?? resolveStorage();
  if (!store) return false;
  return store.getItem(SETTINGS_DIRTY_KEY) === "1";
}

export function clearSettingsDirty(
  storage?: Pick<Storage, "removeItem">,
): void {
  const store = storage ?? resolveStorage();
  store?.removeItem(SETTINGS_DIRTY_KEY);
}

const SYNCED_FIELDS = [
  "targetLanguage",
  "rules",
  "model",
  "autoTranslate",
  "ttsProvider",
  "edgeVoice",
  "elevenLabsVoiceId",
  "ttsRate",
  "ttsRandom",
] as const;

export function applyRemoteSettings(
  remote: { updatedAt: number; data: string },
  storage: SettingsStorage = resolveStorage() ?? MEMORY_STORAGE(),
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

  // Remote may still send legacy `voice` alone.
  const fromRemote = settingsFromPartial({
    ...current,
    ...parsed,
  } as Partial<Settings> & { voice?: unknown });
  const next: Settings = { ...fromRemote, updatedAt: remote.updatedAt };

  for (const field of SYNCED_FIELDS) {
    const value = parsed[field];
    if (field === "autoTranslate") {
      if (typeof value === "boolean") next.autoTranslate = value;
    } else if (field === "ttsProvider") {
      if (
        typeof value === "string" &&
        TTS_PROVIDERS.has(value as TtsProvider)
      ) {
        next.ttsProvider = value as TtsProvider;
      }
    } else if (field === "edgeVoice") {
      if (
        typeof value === "string" &&
        EDGE_VOICES.has(value as EdgeVoiceSetting)
      ) {
        next.edgeVoice = value as EdgeVoiceSetting;
      }
    } else if (field === "elevenLabsVoiceId") {
      if (typeof value === "string") next.elevenLabsVoiceId = value;
    } else if (field === "ttsRate") {
      if (typeof value === "number") next.ttsRate = parseTtsRate(value);
    } else if (field === "ttsRandom") {
      if (typeof value === "boolean") next.ttsRandom = value;
    } else if (typeof value === "string") {
      next[field] = value;
    }
  }

  // Legacy remote voice without new fields.
  if (
    typeof parsed.voice === "string" &&
    parsed.ttsProvider === undefined &&
    (parsed.voice === "system" ||
      parsed.voice === "elvira" ||
      parsed.voice === "alvaro")
  ) {
    const migrated = migrateLegacyVoice(parsed.voice as VoiceSetting);
    next.ttsProvider = migrated.ttsProvider;
    next.edgeVoice = migrated.edgeVoice;
  }

  storage.setItem(SETTINGS_KEY, JSON.stringify(next));
  return next;
}
