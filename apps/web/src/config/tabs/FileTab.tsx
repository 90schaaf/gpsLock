import { parseConfig, type LockationConfig } from '@lockation/core';
import { useState } from 'preact/hooks';
import { issueLabel } from '../issues.js';
import type { TabProps } from '../shared.js';

/** Import / Export tab: the settings file; an import keeps the disclaimer acceptance. */
export function FileTab({ config, edit }: TabProps) {
  return (
    <SettingsFile
      config={config}
      onImport={(next) => edit((d) => {
        const keep = d.disclaimer;
        for (const k of Object.keys(d)) delete (d as Record<string, unknown>)[k];
        Object.assign(d, next, { disclaimer: keep });
      })}
    />
  );
}

/** Export the whole configuration as a JSON file, or import one (validated; the disclaimer acceptance is kept). */
export function SettingsFile({ config, onImport }: { config: LockationConfig; onImport: (c: LockationConfig) => void }) {
  const [msg, setMsg] = useState<{ ok: boolean; text: string }>();
  const download = () => {
    const { disclaimer: _d, ...rest } = config;
    const blob = new Blob([JSON.stringify(rest, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'lockation-config.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    setMsg({ ok: true, text: 'Exported lockation-config.json.' });
  };
  const upload = async (file: File | undefined) => {
    if (!file) return;
    const res = importConfigText(await file.text());
    if (res.ok) {
      onImport(res.config);
      setMsg({ ok: true, text: `Imported "${file.name}" – check the tabs and save.` });
    } else setMsg({ ok: false, text: res.error });
  };
  return (
    <div class="card stack" data-testid="settings-file">
      <h2>💾 Settings file</h2>
      <p class="small muted" style={{ margin: 0 }}>Export all settings as a file to reuse them for another lock, or import a file exported before. Importing replaces the current settings (not saved until you save).</p>
      <div class="row">
        <button onClick={download} data-testid="export-config">⬇ Export</button>
        <label class="btn">
          ⬆ Import…
          <input type="file" accept="application/json,.json" style={{ display: 'none' }} data-testid="import-config" onChange={(e) => void upload((e.target as HTMLInputElement).files?.[0])} />
        </label>
      </div>
      {msg && <p class={`small ${msg.ok ? '' : 'error'}`} style={{ margin: 0 }}>{msg.text}</p>}
    </div>
  );
}

/** Parse an exported settings file (v1 files are migrated). */
export function importConfigText(text: string): { ok: true; config: LockationConfig } | { ok: false; error: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'This is not a valid settings file (not JSON).' };
  }
  const res = parseConfig(raw);
  if (!res.ok) {
    const first = res.issues.slice(0, 3).map((i) => `${issueLabel(i.path, undefined) || i.path}: ${i.message}`).join('; ');
    return { ok: false, error: `The file contains invalid settings (${res.issues.length} problem${res.issues.length === 1 ? '' : 's'}): ${first}` };
  }
  return { ok: true, config: res.config };
}
