import { useEffect, useState } from "react";
import { createApi } from "../lib/api";
import { formatDateTime } from "../lib/format";
import { loadSettings, saveSettings } from "../lib/settings";
import { LAST_SYNC_KEY, runSyncNow, scheduleSync } from "../lib/sync";
import type { EdgeVoiceSetting, Settings, TtsProvider } from "../lib/types";

const PROVIDER_OPTIONS: { value: TtsProvider; label: string }[] = [
  { value: "system", label: "System" },
  { value: "edge", label: "Edge" },
  { value: "elevenlabs", label: "ElevenLabs" },
];

const EDGE_VOICE_OPTIONS: { value: EdgeVoiceSetting; label: string }[] = [
  { value: "elvira", label: "Elvira" },
  { value: "alvaro", label: "Álvaro" },
];

const MODEL_SUGGESTIONS = [
  "space-bunny-free",
  "glm-5.3-flash",
  "deepseek-v4.1-flash",
  "gpt-6-luna",
];

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings>(() => loadSettings());
  const [saved, setSaved] = useState(false);
  const [health, setHealth] = useState<"idle" | "checking" | "ok" | "fail">(
    "idle",
  );
  const [syncState, setSyncState] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState(
    () => Number(localStorage.getItem(LAST_SYNC_KEY) ?? "0") || 0,
  );

  useEffect(() => {
    const reload = () => setSettings(loadSettings());
    window.addEventListener("quiosco:sync", reload);
    return () => window.removeEventListener("quiosco:sync", reload);
  }, []);

  async function onSyncNow() {
    setSyncState("Syncing…");
    try {
      const summary = await runSyncNow();
      setLastSync(Number(localStorage.getItem(LAST_SYNC_KEY) ?? "0") || 0);
      setSyncState(
        summary
          ? `Synced — ${summary.pushed} up, ${summary.pulled} down`
          : "Set the app token first",
      );
    } catch (error) {
      setSyncState(error instanceof Error ? error.message : "Sync failed");
    }
  }

  function update(patch: Partial<Settings>) {
    setSettings((current) => ({ ...current, ...patch }));
    setSaved(false);
  }

  function onSave() {
    saveSettings(settings);
    setSaved(true);
    // Settings are part of the sync payload: schedule a push like any local write.
    scheduleSync();
  }

  async function onCheck() {
    setHealth("checking");
    try {
      await createApi({ token: settings.appToken }).health();
      setHealth("ok");
    } catch {
      setHealth("fail");
    }
  }

  return (
    <section className="settings">
      <h1>Settings</h1>
      <label>
        Target language
        <input
          value={settings.targetLanguage}
          onChange={(event) => update({ targetLanguage: event.target.value })}
        />
      </label>
      <label>
        TTS provider
        <select
          value={settings.ttsProvider}
          onChange={(event) =>
            update({ ttsProvider: event.target.value as TtsProvider })
          }
        >
          {PROVIDER_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      {settings.ttsProvider === "edge" && (
        <label>
          Edge voice
          <select
            value={settings.edgeVoice}
            onChange={(event) =>
              update({ edgeVoice: event.target.value as EdgeVoiceSetting })
            }
          >
            {EDGE_VOICE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {settings.ttsProvider === "elevenlabs" && (
        <>
          <label>
            ElevenLabs voice ID
            <input
              value={settings.elevenLabsVoiceId}
              placeholder="Paste a voice id"
              onChange={(event) =>
                update({ elevenLabsVoiceId: event.target.value })
              }
            />
          </label>
          <p className="muted">
            Store the ElevenLabs key as a Worker secret (see README).
          </p>
        </>
      )}
      <label>
        Translation rules (baked into the prompt)
        <textarea
          rows={4}
          value={settings.rules}
          onChange={(event) => update({ rules: event.target.value })}
        />
      </label>
      <label>
        Model
        <input
          list="model-suggestions"
          value={settings.model}
          onChange={(event) => update({ model: event.target.value })}
        />
      </label>
      <datalist id="model-suggestions">
        {MODEL_SUGGESTIONS.map((model) => (
          <option key={model} value={model} />
        ))}
      </datalist>
      <label>
        App token
        <input
          type="password"
          value={settings.appToken}
          onChange={(event) => update({ appToken: event.target.value })}
        />
      </label>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={settings.autoTranslate}
          onChange={(event) => update({ autoTranslate: event.target.checked })}
        />
        Translate automatically after saving
      </label>
      <div className="row">
        <button type="button" className="primary" onClick={onSave}>
          {saved ? "Saved" : "Save"}
        </button>
        <button type="button" onClick={onCheck}>
          Check connection
        </button>
        {health === "ok" && <span className="muted">Connected</span>}
        {health === "fail" && <span className="error">Not connected</span>}
      </div>
      <div className="row">
        <button type="button" onClick={() => void onSyncNow()}>
          Sync now
        </button>
        <span className="muted">
          {lastSync > 0
            ? `Last sync: ${formatDateTime(lastSync)}`
            : "Never synced"}
        </span>
      </div>
      {syncState && <p className="muted">{syncState}</p>}
      <p className="muted settings-build">Build {__BUILD_ID__}</p>
    </section>
  );
}
