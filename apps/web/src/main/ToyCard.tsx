import { defaultToy, MAX_TOYS, TOY_DISCLAIMER, TOY_DISCLAIMER_VERSION, TOY_TYPE_IDS, TOY_TYPES, ToySetupSchema, type SessionView, type Toy } from '@lockation/core';
import { useState } from 'preact/hooks';
import type { Backend } from '../lib/backend.js';
import type { MockBackend } from '../lib/mock-backend.js';
import { ToyEditor } from '../toys/ToyEditor.js';

/** The setup the wearer prepared on the toy test page (same browser) – offered when connecting. */
function savedSetup(): Toy[] {
  try {
    const r = ToySetupSchema.safeParse(JSON.parse(localStorage.getItem('lockation-toys-setup') ?? 'null'));
    return r.success ? r.data.toys : [];
  } catch {
    return [];
  }
}

const savedWebhook = () => {
  try {
    return localStorage.getItem('lockation-toys-webhook') ?? '';
  } catch {
    return '';
  }
};

const limits = (t: { type: string; maxIntensity: number[]; maxSeconds: number }) =>
  `max ${t.maxIntensity.map((m, i) => `${t.maxIntensity.length > 1 ? `${(TOY_TYPES as Record<string, { channels: readonly string[] }>)[t.type]?.channels[i] ?? i + 1} ` : ''}${m} %`).join(' / ')}, ${t.maxSeconds} s per action`;

/** F27 – toys in a running lock: the wearer connects / tests / stops them, the keyholder sees the status. */
export function ToyCard({ view, backend, mock, onView, onError }: { view: SessionView; backend: Backend; mock?: MockBackend; onView: (v: SessionView) => void; onError: (m: string) => void }) {
  const T = view.toys!;
  const [busy, setBusy] = useState(false);
  const act = async (fn: () => Promise<SessionView>) => {
    setBusy(true);
    try {
      onView(await fn());
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const wearer = view.role === 'wearer';
  const free = T.onEmergencyStop === 'nothing';
  return (
    <div class="card stack" data-testid="toy-card">
      <h2>
        🎮 Toys{' '}
        <span class={`badge ${T.connected ? (T.verified ? 'ok' : 'warn') : ''}`}>{T.connected ? (T.verified ? 'connected' : 'not confirmed') : 'not connected'}</span>
      </h2>
      {T.connected ? (
        <>
          <ul class="small" style={{ margin: 0, paddingLeft: '18px' }}>
            {T.toys.map((t) => (
              <li key={t.id}>
                <strong>{t.name}</strong> – {(TOY_TYPES as Record<string, { label: string }>)[t.type]?.label ?? t.type}, {t.bodyPart} · {limits(t)}
              </li>
            ))}
          </ul>
          {T.running.length > 0 && (
            <p class="small" style={{ margin: 0 }} data-testid="toy-running">
              {T.running.map((r) => (
                <span key={r.toy + r.channel} style={{ display: 'block' }}>
                  ▶ <strong>{r.toy}</strong>{r.channel !== 'all' ? ` ${r.channel}` : ''}: {r.shape} {r.level} % {r.label}{r.paused ? ' (paused for a one-off action)' : ''}
                </span>
              ))}
            </p>
          )}
          {!T.verified && (
            <p class="small warn-text" style={{ margin: 0 }} data-testid="toy-unverified">
              {wearer ? 'Please test your toys and confirm that they react.' : 'The wearer has not confirmed yet that the toys react.'} Toy actions are sent anyway.
            </p>
          )}
          {wearer && (
            <div class="row">
              <button disabled={busy} onClick={() => act(() => backend.toyTest())} data-testid="toy-test">▶ Test pulse</button>
              {!T.verified && (
                <button class="primary" disabled={busy} onClick={() => act(() => backend.toyConfirm())} data-testid="toy-confirm">
                  ✓ My toys reacted
                </button>
              )}
            </div>
          )}
          {wearer && (
            <button
              class="danger-big"
              disabled={busy}
              data-testid="toy-emergency-stop"
              onClick={() => confirm(`Emergency stop: stop and disconnect all toys?\n\n${free ? 'No consequences.' : `This costs: ${T.onEmergencyStop}.`}`) && act(() => backend.toyEmergencyStop())}
            >
              🛑 EMERGENCY STOP – disconnect toys
            </button>
          )}
          {wearer && <p class="small muted" style={{ margin: 0 }}>{free ? 'The emergency stop has no consequences.' : `Emergency stop costs: ${T.onEmergencyStop}.`} You can connect again afterwards.</p>}
        </>
      ) : wearer ? (
        <ConnectForm busy={busy} onConnect={(input) => act(() => backend.toyConnect(input))} />
      ) : (
        <p class="small muted" style={{ margin: 0 }}>The wearer has not connected any toys – toy actions are skipped (and logged) until they do.</p>
      )}
      {T.emergencyStops > 0 && <p class="small muted" style={{ margin: 0 }}>Emergency stops so far: {T.emergencyStops}.</p>}
      {mock && wearer && <DemoRealToggle mock={mock} />}
    </div>
  );
}

function DemoRealToggle({ mock }: { mock: MockBackend }) {
  const [on, setOn] = useState(mock.toyReal);
  return (
    <label class="check small">
      <input
        type="checkbox"
        checked={on}
        data-testid="toy-demo-real"
        onChange={(e) => {
          const v = (e.target as HTMLInputElement).checked;
          mock.toyReal = v;
          setOn(v);
        }}
      />
      Demo: really send the demo rules' toy actions to my toys (otherwise they are only shown in the log)
    </label>
  );
}

function ConnectForm({ busy, onConnect }: { busy: boolean; onConnect: (input: { webhookId: string; toys: Toy[]; disclaimerVersion: number }) => void }) {
  const [accepted, setAccepted] = useState(false);
  const [webhookId, setWebhookId] = useState(savedWebhook);
  const [toys, setToys] = useState<Toy[]>(savedSetup);
  const valid = ToySetupSchema.safeParse({ version: 1, toys });
  const edit = (fn: (t: Toy[]) => void) =>
    setToys((cur) => {
      const d = JSON.parse(JSON.stringify(cur)) as Toy[];
      fn(d);
      return d;
    });
  const nextId = () => {
    for (let i = 1; ; i++) if (!toys.some((t) => t.id === `toy${i}`)) return `toy${i}`;
  };
  return (
    <div class="stack" data-testid="toy-connect">
      <p class="small" style={{ margin: 0 }}>
        Set up and try your toys first on the <a href="toys.html" target="_blank" rel="noopener">toy test page</a> (it also gives you the XToys script). The setup
        from there is used here.
      </p>
      <ul class="small" style={{ margin: 0, paddingLeft: '18px' }}>
        {TOY_DISCLAIMER.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
      <label class="check">
        <input type="checkbox" checked={accepted} onChange={(e) => setAccepted((e.target as HTMLInputElement).checked)} data-testid="toy-accept" />
        <span>I have read this and accept it.</span>
      </label>
      <label class="field">
        Your XToys Webhook ID
        <input value={webhookId} autoComplete="off" spellcheck={false} placeholder="XToys → your profile → Private Webhook" data-testid="toy-connect-webhook" onInput={(e) => setWebhookId((e.target as HTMLInputElement).value.trim())} />
      </label>
      {toys.map((t, i) => (
        <ToyEditor key={t.id} toy={t} slot="" onChange={(fn) => edit((d) => fn(d[i]!))} onRemove={() => edit((d) => { d.splice(i, 1); })} />
      ))}
      <div class="row">
        <span class="small muted">Add:</span>
        {TOY_TYPE_IDS.map((type) => (
          <button key={type} disabled={toys.length >= MAX_TOYS} onClick={() => edit((d) => { d.push(defaultToy(type, nextId())); })}>
            + {TOY_TYPES[type].label}
          </button>
        ))}
      </div>
      <p class="small muted" style={{ margin: 0 }}>Your limits are fixed while connected – changing them means disconnecting (emergency stop).</p>
      <button
        class="primary"
        data-testid="toy-connect-button"
        disabled={busy || !accepted || !webhookId || !toys.length || !valid.success}
        onClick={() => onConnect({ webhookId, toys, disclaimerVersion: TOY_DISCLAIMER_VERSION })}
      >
        🎮 Connect toys
      </button>
    </div>
  );
}
