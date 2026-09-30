import { useState } from "react";
import { createApi } from "../lib/api";
import { loadSettings, saveSettings } from "../lib/settings";
import type { Settings } from "../lib/types";

const MODEL_SUGGESTIONS = [
  "deepseek-v4.1-flash",
  "big-pickle",
  "space-bunny-free",
  "longcat-2.5-preview-free",
  "mimo-v2.6-flash-free",
  "nemotron-3.5-lightning-free",
  "gemini-3.5-flash-lite",
];

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings>(() => loadSettings());
  const [saved, setSaved] = useState(false);
  const [health, setHealth] = useState<"idle" | "checking" | "ok" | "fail">(
    "idle",
  );

  function update(patch: Partial<Settings>) {
    setSettings((current) => ({ ...current, ...patch }));
    setSaved(false);
  }

  function onSave() {
    saveSettings(settings);
    setSaved(true);
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
      <p className="muted">
        Required setup: a dedicated OpenCode Zen key with a workspace monthly
        limit and auto-reload off (see the deployment checklist in the README).
        When earlier rungs fail, only the article URL is sent to jina.ai,
        web.archive.org, or archive.ph.
      </p>
    </section>
  );
}
