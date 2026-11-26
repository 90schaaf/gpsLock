/**
 * F27 – toy test page: the wearer sets up their toys, downloads the Lockation XToys script and tries every action
 * before a lock. Talks to XToys directly from the browser; nothing is stored on the Lockation server.
 */
import {
  buildXToysScript,
  defaultToy,
  MAX_TOYS,
  TOY_DISCLAIMER,
  TOY_DISCLAIMER_VERSION,
  TOY_SHAPES,
  TOY_TYPE_IDS,
  TOY_TYPES,
  ToyCommandError,
  toyCommand,
  ToySetupSchema,
  toySlots,
  xtoysWebsocketUrl,
  type Toy,
  type ToyCommandInput,
  type ToySetup,
  type ToyShape,
} from '@lockation/core';
import { useEffect, useState } from 'preact/hooks';
import { sendRaw, sendToXToys } from '../lib/xtoys.js';
import { ToyEditor } from './ToyEditor.js';

export { sendRaw, sendToXToys };

const KEY_SETUP = 'lockation-toys-setup';
const KEY_ID = 'lockation-toys-webhook';
const KEY_DISCLAIMER = 'lockation-toys-disclaimer';

const store = {
  get(k: string): string | null {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string | null) {
    try {
      if (v === null) localStorage.removeItem(k);
      else localStorage.setItem(k, v);
    } catch {
      /* private mode – nothing remembered */
    }
  },
};

function loadSetup(): ToySetup {
  try {
    const r = ToySetupSchema.safeParse(JSON.parse(store.get(KEY_SETUP) ?? 'null'));
    if (r.success) return r.data;
  } catch {
    /* fall through */
  }
  return { version: 1, toys: [] };
}

function download(name: string, text: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const newToyId = (setup: ToySetup) => {
  for (let i = 1; ; i++) if (!setup.toys.some((t) => t.id === `toy${i}`)) return `toy${i}`;
};

interface LogLine {
  at: string;
  text: string;
  ok: boolean;
}

export function ToysApp({ fetchImpl = fetch }: { fetchImpl?: typeof fetch }) {
  const [setup, setSetup] = useState<ToySetup>(loadSetup);
  const [webhookId, setWebhookId] = useState(store.get(KEY_ID) ?? '');
  const [remember, setRemember] = useState(store.get(KEY_ID) !== null);
  const [accepted, setAccepted] = useState(store.get(KEY_DISCLAIMER) === String(TOY_DISCLAIMER_VERSION));
  const [log, setLog] = useState<LogLine[]>([]);
  const [connected, setConnected] = useState<string>();

  useEffect(() => store.set(KEY_SETUP, JSON.stringify(setup)), [setup]);
  useEffect(() => store.set(KEY_ID, remember && webhookId ? webhookId : null), [remember, webhookId]);
  useEffect(() => store.set(KEY_DISCLAIMER, accepted ? String(TOY_DISCLAIMER_VERSION) : null), [accepted]);

  const valid = ToySetupSchema.safeParse(setup);
  const ready = accepted && webhookId.trim().length > 0 && valid.success;
  const note = (text: string, ok = true) => setLog((l) => [{ at: new Date().toLocaleTimeString(), text, ok }, ...l].slice(0, 30));

  const edit = (fn: (d: ToySetup) => void) =>
    setSetup((s) => {
      const d = JSON.parse(JSON.stringify(s)) as ToySetup;
      fn(d);
      return d;
    });

  async function send(toyId: string, input: ToyCommandInput, label: string) {
    if (!webhookId.trim()) return note('Enter your Webhook ID first.', false);
    try {
      const body = toyCommand(setup, toyId, input);
      const r = await sendToXToys(webhookId, body, fetchImpl);
      note(`${label}${r === 'unconfirmed' ? ' – sent (the browser cannot read XToys’ answer)' : ' – sent'}`);
    } catch (e) {
      note(`${label} – ${e instanceof ToyCommandError || e instanceof Error ? e.message : String(e)}`, false);
    }
  }

  async function testAll() {
    for (const t of setup.toys) {
      await send(t.id, { cmd: 'play', shape: 'pulse', intensity: 30, seconds: 2 }, `Test ${t.name}`);
      await new Promise((r) => setTimeout(r, 2500));
    }
  }

  function checkConnected() {
    if (!webhookId.trim()) return note('Enter your Webhook ID first.', false);
    setConnected('Asking XToys …');
    let done = false;
    const ws = new WebSocket(xtoysWebsocketUrl(webhookId));
    const timer = setTimeout(() => {
      if (!done) setConnected('No answer within 8 s – is the Lockation script running in XToys, with "Script can send outbound messages" enabled?');
      ws.close();
    }, 8000);
    ws.onopen = () => ws.send(JSON.stringify({ action: 'getToys' }));
    ws.onmessage = (m) => {
      done = true;
      clearTimeout(timer);
      setConnected(formatConnected(setup, String(m.data)));
      ws.close();
    };
    ws.onerror = () => setConnected('Could not open the XToys connection.');
  }

  return (
    <div class="container stack">
      <h1>🎮 Lockation toy test</h1>
      <p class="muted small" style={{ margin: 0 }}>
        Set up your toys, load the Lockation script into XToys and try everything before a lock. Your Webhook ID stays in this browser – it is never sent to
        Lockation.
      </p>

      <div class="card stack" data-testid="toy-disclaimer">
        <h2>1. Safety first</h2>
        <ul class="small" style={{ margin: 0 }}>
          {TOY_DISCLAIMER.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
        <label class="check">
          <input type="checkbox" checked={accepted} onChange={(e) => setAccepted((e.target as HTMLInputElement).checked)} />
          <span>I have read this and accept it.</span>
        </label>
      </div>

      <div class="card stack">
        <h2>2. Your toys</h2>
        {setup.toys.map((t, i) => (
          <ToyEditor key={t.id} toy={t} slot={toySlots(setup)[t.id]!} onChange={(fn) => edit((d) => fn(d.toys[i]!))} onRemove={() => edit((d) => { d.toys.splice(i, 1); })} />
        ))}
        {setup.toys.length === 0 && <p class="small muted" style={{ margin: 0 }}>No toys yet – add the toys you will use.</p>}
        <div class="row" data-testid="toy-add">
          <span class="small muted">Add:</span>
          {TOY_TYPE_IDS.map((type) => (
            <button key={type} disabled={setup.toys.length >= MAX_TOYS} onClick={() => edit((d) => { d.toys.push(defaultToy(type, newToyId(d))); })}>
              + {TOY_TYPES[type].label}
            </button>
          ))}
        </div>
        {!valid.success && <p class="small error" style={{ margin: 0 }}>{valid.error.issues[0]?.message}</p>}
      </div>

      <div class="card stack">
        <h2>3. XToys script</h2>
        <ol class="small" style={{ margin: 0, paddingLeft: '18px' }}>
          <li>Download the script (it is made for exactly the toys above – download it again after changes).</li>
          <li>In XToys, import it as a new script.</li>
          <li>Start it. The script uses your account's <strong>Private Webhook</strong> (XToys → your profile) – enter that Webhook ID below. If XToys asks how to connect the webhook, choose the private (cloud) webhook, not the local one, and allow <em>Script can send outbound messages</em>.</li>
          <li>Connect each real toy to its slot (named like the toy above, e.g. “{setup.toys[0]?.name ?? 'Bullet'} ({setup.toys[0]?.bodyPart ?? 'genitals'})”).</li>
        </ol>
        <div class="row">
          <button class="primary" disabled={!valid.success || setup.toys.length === 0} data-testid="toy-script" onClick={() => download('lockation-xtoys-script.json', JSON.stringify(buildXToysScript(setup), null, 2))}>
            ⬇ Download XToys script
          </button>
          <button onClick={() => download('lockation-toys.json', JSON.stringify(setup, null, 2))} disabled={!valid.success}>
            💾 Export toy setup
          </button>
          <label class="small">
            Import toy setup <input type="file" accept="application/json" onChange={(e) => importSetup(e, setSetup, note)} />
          </label>
        </div>
      </div>

      <div class="card stack">
        <h2>4. Connect &amp; test</h2>
        <label class="field">
          Your XToys Webhook ID (XToys → your profile → Private Webhook)
          <input value={webhookId} placeholder="e.g. ABCD1234" autoComplete="off" spellcheck={false} data-testid="toy-webhook" onInput={(e) => setWebhookId((e.target as HTMLInputElement).value.trim())} />
        </label>
        <label class="check small">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember((e.target as HTMLInputElement).checked)} />
          Remember it in this browser
        </label>
        {!accepted && <p class="small warn-text" style={{ margin: 0 }}>Accept the safety notes first.</p>}
        <div class="row">
          <button class="primary" disabled={!ready || setup.toys.length === 0} onClick={testAll} data-testid="toy-test-all">
            ▶ Test all toys (2 s pulse each)
          </button>
          <button disabled={!webhookId} onClick={checkConnected}>
            🔍 Which toys does XToys see?
          </button>
        </div>
        {connected && <p class="small mono" style={{ margin: 0, whiteSpace: 'pre-wrap' }} data-testid="toy-connected">{connected}</p>}
        {setup.toys.map((t) => (
          <ToyTester key={t.id} toy={t} disabled={!ready} onSend={(input, label) => send(t.id, input, label)} />
        ))}
      </div>

      <button class="danger-big" data-testid="toy-stop-all" disabled={!webhookId} onClick={() => send('all', { cmd: 'stop' }, '■ Stop all')}>
        ■ STOP ALL TOYS
      </button>

      {log.length > 0 && (
        <div class="card stack">
          <h2>Log</h2>
          <ul class="small mono" style={{ margin: 0, paddingLeft: '18px' }} data-testid="toy-log">
            {log.map((l, i) => (
              <li key={i} class={l.ok ? '' : 'error'}>
                {l.at} {l.text}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function importSetup(e: Event, set: (s: ToySetup) => void, note: (t: string, ok?: boolean) => void) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  file.text().then((text) => {
    try {
      const r = ToySetupSchema.safeParse(JSON.parse(text));
      if (!r.success) return note(`Import failed: ${r.error.issues[0]?.message}`, false);
      set(r.data);
      note(`Imported ${r.data.toys.length} toys.`);
    } catch {
      note('Import failed: not a toy setup file.', false);
    }
  });
}

/** Human readable answer of the script's `getToys` trigger. */
export function formatConnected(setup: ToySetup, raw: string): string {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return `XToys answered: ${raw}`;
  }
  const map = (data && typeof data === 'object' && 'webhookData' in data ? (data as { webhookData: unknown }).webhookData : data) as Record<string, { name: string }[]>;
  const slots = toySlots(setup);
  return setup.toys
    .map((t) => {
      const got = map?.[slots[t.id]!] ?? [];
      return `${got.length ? '✅' : '⚠'} ${t.name}: ${got.length ? got.map((g) => g.name).join(', ') : 'no toy connected to this slot'}`;
    })
    .join('\n');
}

function ToyTester({ toy, disabled, onSend }: { toy: Toy; disabled: boolean; onSend: (input: ToyCommandInput, label: string) => void }) {
  const chans = TOY_TYPES[toy.type].channels as readonly string[];
  const [channel, setChannel] = useState('all');
  const [shape, setShape] = useState<ToyShape>('pulse');
  const [intensity, setIntensity] = useState(30);
  const [seconds, setSeconds] = useState(5);
  const ch = chans.length > 1 ? channel : undefined;
  const max = 100; // the wearer's limits are applied by XToys
  const tag = `${toy.name}${ch && ch !== 'all' ? ` ${ch}` : ''}`;
  return (
    <div class="card stack" style={{ padding: '10px 12px' }} data-testid="toy-tester">
      <strong>
        {toy.name} <span class="small muted">({TOY_TYPES[toy.type].label}, {toy.bodyPart})</span>
      </strong>
      <div class="grid2">
        {chans.length > 1 && (
          <label class="field">
            Channel
            <select value={channel} onChange={(e) => setChannel((e.target as HTMLSelectElement).value)}>
              <option value="all">Both</option>
              {chans.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </label>
        )}
        <label class="field">
          Pattern
          <select value={shape} onChange={(e) => setShape((e.target as HTMLSelectElement).value as ToyShape)}>
            {TOY_SHAPES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>
        <label class="field">
          Intensity: {Math.min(intensity, max)} %
          <input type="range" min={0} max={max} step={1} value={Math.min(intensity, max)} onInput={(e) => setIntensity(Number((e.target as HTMLInputElement).value))} />
        </label>
        <label class="field">
          Duration (seconds)
          <input type="number" min={1} max={3600} value={seconds} onInput={(e) => setSeconds(Number((e.target as HTMLInputElement).value) || 1)} />
        </label>
      </div>
      <div class="row">
        <button class="primary" disabled={disabled} onClick={() => onSend({ cmd: 'play', shape, intensity, seconds, channel: ch }, `▶ ${tag}: ${shape} ${Math.min(intensity, max)} % for ${seconds} s`)}>
          ▶ Play
        </button>
        <button disabled={disabled} onClick={() => onSend({ cmd: 'intensity', intensity, channel: ch }, `${tag}: intensity ${Math.min(intensity, max)} %`)}>Set intensity</button>
        <button disabled={disabled} onClick={() => onSend({ cmd: 'intensity', delta: 10, channel: ch }, `${tag}: +10 %`)}>+10 %</button>
        <button disabled={disabled} onClick={() => onSend({ cmd: 'intensity', delta: -10, channel: ch }, `${tag}: −10 %`)}>−10 %</button>
        {TOY_TYPES[toy.type].shock && (
          <button disabled={disabled} onClick={() => onSend({ cmd: 'shock', intensity, seconds: Math.min(seconds, 2), channel: ch }, `⚡ ${tag}: shock ${Math.min(intensity, max)} %`)}>⚡ Shock</button>
        )}
        <button onClick={() => onSend({ cmd: 'stop', channel: ch }, `■ ${tag}: stop`)}>■ Stop</button>
      </div>
    </div>
  );
}

