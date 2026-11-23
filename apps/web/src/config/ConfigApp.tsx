import { DISCLAIMER_VERSION, disclaimerAccepted, MAX_PLACES, MIN_RADIUS_M, MAX_RADIUS_M, parseConfig, type ConfigIssue, type LockationConfig } from '@lockation/core';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { LeafletMap, ZONE_COLORS, type MapCircle } from '../components/LeafletMap.js';
import { ApiError, type Backend, type CommandInfo } from '../lib/backend.js';
import { ConfigBridge } from '../lib/config-bridge.js';
import { isEmbedded } from '../lib/hash.js';
import { ConsequenceEditor, NumberField, ZonePicker } from './editors.js';

type Tab = 'zones' | 'required' | 'forbidden' | 'reward' | 'travel' | 'hunt' | 'tracking' | 'anticheat' | 'privacy';
const TABS: { id: Tab; label: string }[] = [
  { id: 'zones', label: '🗺 Zones' },
  { id: 'required', label: '⏱ Required' },
  { id: 'forbidden', label: '⛔ Forbidden' },
  { id: 'reward', label: '🏆 Reward' },
  { id: 'travel', label: '🚶 Travel' },
  { id: 'hunt', label: '🧭 Hunt' },
  { id: 'tracking', label: '📡 Tracking' },
  { id: 'anticheat', label: '🛡 Anti-cheat' },
  { id: 'privacy', label: '🔒 Privacy' },
];

const newId = (prefix: string) => `${prefix}${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;

const km = (n: number) => `${Math.round(n * 100) / 100} km`;
const rewards = (n: number) => `${n} reward${n === 1 ? '' : 's'}`;

/** Worked example for the travel tab, built from the current settings. */
export function travelExample(stepKm: number, maxKmPerCheckin: number): string {
  if (!(stepKm > 0) || !(maxKmPerCheckin > 0)) return '';
  const moved = stepKm * 2.5;
  const counted = Math.min(moved, maxKmPerCheckin);
  const steps = Math.floor(counted / stepKm + 1e-9);
  const rest = counted - steps * stepKm;
  const first =
    `Example: moving ${km(moved)} between two check-ins counts ${km(counted)} → ${rewards(steps)}` +
    (rest > 1e-9 ? `, ${km(rest)} carried over.` : '.');
  const jump = Math.max(40, Math.ceil(maxKmPerCheckin * 4));
  const second = ` A ${km(jump)} train ride counts only ${km(maxKmPerCheckin)} → ${rewards(Math.floor(maxKmPerCheckin / stepKm + 1e-9))}.`;
  return first + second;
}

export function ConfigApp({ backend, bridge }: { backend: Backend; bridge: ConfigBridge }) {
  const [config, setConfig] = useState<LockationConfig>();
  const [role, setRole] = useState<string>();
  const [running, setRunning] = useState(false);
  const [loadError, setLoadError] = useState<string>();
  const [serverIssues, setServerIssues] = useState<ConfigIssue[]>();
  const [saveMsg, setSaveMsg] = useState<string>();
  const [commands, setCommands] = useState<CommandInfo[]>([]);
  const [tab, setTab] = useState<Tab>('zones');
  const [selected, setSelected] = useState<string>();
  const [fitKey, setFitKey] = useState('init');
  const embedded = useMemo(isEmbedded, []);
  const configRef = useRef<LockationConfig>();
  configRef.current = config;

  useEffect(() => {
    backend
      .configGet()
      .then((r) => {
        const cfg = r.config.zones.length === 0 && r.config.timezone === 'UTC' ? { ...r.config, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' } : r.config;
        setConfig(cfg);
        setRole(r.role);
        setRunning(!!r.sessionId);
        if (r.invalidStoredConfig) setServerIssues(r.invalidStoredConfig);
        setFitKey('loaded');
      })
      .catch((e) => setLoadError(e instanceof Error ? e.message : String(e)));
    backend.capabilities().then((r) => setCommands(r.commands)).catch(() => undefined);
  }, []);

  const validation = useMemo(() => (config ? parseConfig(config) : undefined), [config]);
  const issues = validation && !validation.ok ? validation.issues : [];

  async function save() {
    const cfg = configRef.current;
    if (!cfg) throw new Error('not loaded');
    const v = parseConfig(cfg);
    if (!v.ok) {
      setSaveMsg('Please fix the problems listed above.');
      throw new Error('invalid');
    }
    if (!disclaimerAccepted(v.config)) {
      setSaveMsg('Please accept the disclaimer at the bottom of the page before saving.');
      throw new Error('disclaimer');
    }
    try {
      await backend.configSave(v.config);
      setServerIssues(undefined);
      setSaveMsg('Saved ✓');
    } catch (e) {
      if (e instanceof ApiError && Array.isArray(e.details)) setServerIssues(e.details as ConfigIssue[]);
      setSaveMsg(e instanceof Error ? e.message : String(e));
      throw e;
    }
  }

  // Chaster's own Save button (F11)
  useEffect(() => {
    bridge.announce();
    return bridge.onSaveRequested(() => {
      void bridge.runSave(save);
    });
  }, []);

  if (loadError) {
    return (
      <div class="container">
        <div class="card error">{loadError}</div>
        <div class="card small">Not opened from Chaster? Try the <a href="?demo">demo configuration</a>.</div>
      </div>
    );
  }
  if (!config) return <div class="container"><div class="card muted">Loading configuration…</div></div>;

  const edit = (fn: (d: LockationConfig) => void) =>
    setConfig((c) => {
      const d = JSON.parse(JSON.stringify(c)) as LockationConfig;
      fn(d);
      return d;
    });
  const R = config.rules;

  const isHunt = tab === 'hunt';
  const circles: MapCircle[] = isHunt
    ? R.hunt.checkpoints.map((c, i) => ({ id: c.id, lat: c.lat, lng: c.lng, radiusM: c.radiusM, color: ZONE_COLORS.hunt, label: `${i + 1}. ${c.name}`, draggable: true, selected: c.id === selected }))
    : config.zones.map((z) => {
        const kind = R.forbidden.enabled && R.forbidden.zoneIds.includes(z.id) ? 'forbidden' : R.required.enabled && R.required.zoneIds.includes(z.id) ? 'required' : R.reward.enabled && R.reward.zoneIds.includes(z.id) ? 'reward' : 'neutral';
        return { id: z.id, lat: z.lat, lng: z.lng, radiusM: z.radiusM, color: ZONE_COLORS[kind], label: z.name, draggable: true, selected: z.id === selected };
      });

  const placeCount = config.zones.length + R.hunt.checkpoints.length;
  const placesFull = placeCount >= MAX_PLACES;
  const placesInfo = (
    <p class={`small ${placesFull ? 'warn-text' : 'muted'}`} data-testid="place-count" style={{ margin: 0 }}>
      {placeCount} / {MAX_PLACES} places used (zones + hunt checkpoints).
      {placesFull && ' Limit reached – delete a zone or checkpoint to add a new one.'}
    </p>
  );

  function addAt(p: { lat: number; lng: number }, name?: string) {
    if (placesFull) {
      setTab(isHunt ? 'hunt' : 'zones'); // shows the "limit reached" note
      return;
    }
    if (isHunt) {
      const id = newId('cp');
      edit((d) => {
        d.rules.hunt.checkpoints.push({ id, name: name ?? `Checkpoint ${d.rules.hunt.checkpoints.length + 1}`, lat: p.lat, lng: p.lng, radiusM: 75, hint: '' });
      });
      setSelected(id);
    } else {
      const id = newId('z');
      edit((d) => {
        d.zones.push({ id, name: (name ?? `Zone ${d.zones.length + 1}`).slice(0, 60), lat: p.lat, lng: p.lng, radiusM: 150 });
      });
      setSelected(id);
      if (tab !== 'zones') setTab('zones');
    }
  }

  function move(id: string, p: { lat: number; lng: number }) {
    edit((d) => {
      const z = d.zones.find((x) => x.id === id) ?? d.rules.hunt.checkpoints.find((x) => x.id === id);
      if (z) {
        z.lat = p.lat;
        z.lng = p.lng;
      }
    });
  }

  const mapUsable = tab === 'zones' || tab === 'hunt';

  return (
    <div class="container">
      <header class="top">
        <h1>📍 Lockation – configuration</h1>
        {role && <span class="badge accent">{role}</span>}
        {running && <span class="badge warn">lock running</span>}
        {backend.demo && <span class="badge">demo</span>}
      </header>

      {issues.length > 0 && (
        <div class="card">
          <strong class="error">Please fix:</strong>
          <ul class="issues">
            {issues.map((i) => (
              <li key={i.path + i.message}>
                {i.path || 'config'}: {i.message}
              </li>
            ))}
          </ul>
        </div>
      )}
      {serverIssues && serverIssues.length > 0 && (
        <div class="card small error">Server: {serverIssues.map((i) => `${i.path}: ${i.message}`).join('; ')}</div>
      )}

      <div class="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} class={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)} role="tab" aria-selected={tab === t.id}>
            {t.label}
            {(t.id === 'tracking' ? config.tracking.enabled : t.id !== 'zones' && t.id !== 'anticheat' && t.id !== 'privacy' && R[t.id as keyof typeof R]?.enabled) ? ' ●' : ''}
          </button>
        ))}
      </div>

      {mapUsable && (
        <>
          <AddressSearch onPick={(p, name) => { addAt(p, name); setFitKey(newId('f')); }} />
          <LeafletMap
            circles={circles}
            fitKey={`${fitKey}-${tab}`}
            height="360px"
            onClick={addAt}
            onCircleClick={setSelected}
            onCircleMove={move}
          />
          <p class="small muted" style={{ margin: 0 }}>
            Tap the map to add a {isHunt ? 'checkpoint' : 'zone'}; drag the handle to move it. Radius {MIN_RADIUS_M} m – {MAX_RADIUS_M / 1000} km.
          </p>
        </>
      )}

      {tab === 'zones' && (
        <div class="card">
          <h2>Zones</h2>
          {placesInfo}
          <ul class="plain zone-list">
            {config.zones.map((z, i) => (
              <li key={z.id} class={z.id === selected ? 'selected' : ''} onClick={() => setSelected(z.id)}>
                <span class="dot" style={{ background: circles[i]?.color }} />
                <input value={z.name} maxLength={60} aria-label="zone name" onInput={(e) => edit((d) => { d.zones[i]!.name = (e.target as HTMLInputElement).value; })} />
                <input type="number" style={{ width: '90px' }} min={MIN_RADIUS_M} max={MAX_RADIUS_M} value={z.radiusM} aria-label="radius" onInput={(e) => edit((d) => { d.zones[i]!.radiusM = Number((e.target as HTMLInputElement).value); })} />
                <span class="small muted">m</span>
                <button class="link danger" aria-label="delete zone" onClick={(e) => { e.stopPropagation(); edit((d) => {
                  d.zones.splice(i, 1);
                  for (const r of [d.rules.required, d.rules.forbidden, d.rules.reward, d.rules.curfew]) r.zoneIds = r.zoneIds.filter((x) => x !== z.id);
                }); }}>✕</button>
              </li>
            ))}
          </ul>
          {config.zones.length === 0 && <p class="muted">No zones yet – tap the map or search an address.</p>}
          <div class="grid2" style={{ marginTop: '10px' }}>
            <label class="field">
              Zone matching
              <select value={config.matchMode} onChange={(e) => edit((d) => { d.matchMode = (e.target as HTMLSelectElement).value as 'lenient' | 'strict'; })}>
                <option value="lenient">Lenient – position inside zone</option>
                <option value="strict">Strict – whole accuracy circle inside</option>
              </select>
            </label>
            <label class="field">
              Timezone (for quiet hours & daily limits)
              <input value={config.timezone} onInput={(e) => edit((d) => { d.timezone = (e.target as HTMLInputElement).value; })} />
            </label>
          </div>
        </div>
      )}

      {tab === 'required' && (
        <Section title="Required check-in" enabled={R.required.enabled} onToggle={(v) => edit((d) => { d.rules.required.enabled = v; })}
          help="The wearer must check in regularly. Leave all zones unchecked to allow check-ins anywhere (proves the position, makes forbidden zones enforceable).">
          <ZonePicker zones={config.zones} value={R.required.zoneIds} onChange={(ids) => edit((d) => { d.rules.required.zoneIds = ids; })} />
          <div class="grid2">
            <NumberField label="Interval" suffix="minutes" min={15} value={R.required.intervalMinutes} onChange={(v) => edit((d) => { d.rules.required.intervalMinutes = v ?? 240; })} />
            <NumberField label="Grace period" suffix="minutes" min={0} value={R.required.graceMinutes} onChange={(v) => edit((d) => { d.rules.required.graceMinutes = v ?? 0; })} />
            <label class="check">
              <input type="checkbox" checked={!!R.required.quietHours} onChange={(e) => edit((d) => { d.rules.required.quietHours = (e.target as HTMLInputElement).checked ? { start: '23:00', end: '07:00' } : undefined; })} />
              Quiet hours (no deadline inside)
            </label>
            {R.required.quietHours && (
              <div class="row">
                <input type="time" value={R.required.quietHours.start} onInput={(e) => edit((d) => { d.rules.required.quietHours!.start = (e.target as HTMLInputElement).value; })} />
                –
                <input type="time" value={R.required.quietHours.end} onInput={(e) => edit((d) => { d.rules.required.quietHours!.end = (e.target as HTMLInputElement).value; })} />
              </div>
            )}
          </div>
          <ConsequenceEditor label="When a check-in is missed" value={R.required.onMissed} commands={commands} onChange={(v) => edit((d) => { d.rules.required.onMissed = v; })} />
          <ConsequenceEditor label="When checking in outside the required zones" value={R.required.onOutside} commands={commands} onChange={(v) => edit((d) => { d.rules.required.onOutside = v; })} />
          <ConsequenceEditor label="On every successful check-in" value={R.required.onSuccess} commands={commands} onChange={(v) => edit((d) => { d.rules.required.onSuccess = v; })} />
        </Section>
      )}

      {tab === 'forbidden' && (
        <Section title="Forbidden zones" enabled={R.forbidden.enabled} onToggle={(v) => edit((d) => { d.rules.forbidden.enabled = v; })}
          help="Checking in inside one of these zones triggers the consequences. Combine with a required check-in so the wearer has to reveal their position.">
          <ZonePicker zones={config.zones} value={R.forbidden.zoneIds} onChange={(ids) => edit((d) => { d.rules.forbidden.zoneIds = ids; })} />
          <NumberField label="Cooldown per zone" suffix="minutes" min={0} value={R.forbidden.cooldownMinutes} onChange={(v) => edit((d) => { d.rules.forbidden.cooldownMinutes = v ?? 0; })} />
          <ConsequenceEditor label="When inside a forbidden zone" value={R.forbidden.onEnter} commands={commands} onChange={(v) => edit((d) => { d.rules.forbidden.onEnter = v; })} />
        </Section>
      )}

      {tab === 'reward' && (
        <Section title="Reward zones" enabled={R.reward.enabled} onToggle={(v) => edit((d) => { d.rules.reward.enabled = v; })} help="Checking in at a goal location (gym, work, …) gives a reward.">
          <ZonePicker zones={config.zones} value={R.reward.zoneIds} onChange={(ids) => edit((d) => { d.rules.reward.zoneIds = ids; })} />
          <div class="grid2">
            <NumberField label="Cooldown per zone" suffix="minutes" min={0} value={R.reward.cooldownMinutes} onChange={(v) => edit((d) => { d.rules.reward.cooldownMinutes = v ?? 0; })} />
            <NumberField label="Max rewards per day" min={1} value={R.reward.maxPerDay} onChange={(v) => edit((d) => { d.rules.reward.maxPerDay = v ?? 1; })} />
            <NumberField label="Minimum stay" suffix="minutes, 0 = immediately" min={0} value={R.reward.dwellMinutes} onChange={(v) => edit((d) => { d.rules.reward.dwellMinutes = v ?? 0; })} />
          </div>
          <ConsequenceEditor label="Reward" value={R.reward.onEnter} commands={commands} onChange={(v) => edit((d) => { d.rules.reward.onEnter = v; })} />
        </Section>
      )}

      {tab === 'travel' && (
        <Section title="Travel goals" enabled={R.travel.enabled} onToggle={(v) => edit((d) => { d.rules.travel.enabled = v; })}
          help="The straight-line distance between consecutive check-ins (or background updates) counts. Time consequences are multiplied by the number of completed steps.">
          <div class="grid2">
            <NumberField label="Step size – distance per reward" suffix="km" min={0.1} step={0.1} value={R.travel.stepKm} onChange={(v) => edit((d) => { d.rules.travel.stepKm = v ?? 1; })}
              hint="Every full step runs the consequences below once. Leftover distance carries over." />
            <NumberField label="Max per check-in – limit for one jump" suffix="km" min={0.1} step={0.1} value={R.travel.maxKmPerCheckin} onChange={(v) => edit((d) => { d.rules.travel.maxKmPerCheckin = v ?? 50; })}
              hint="A single check-in never adds more than this, e.g. after a train ride." />
            <NumberField label="Daily cap – limit per day" suffix="km" min={0.1} step={0.1} value={R.travel.dailyCapKm} onChange={(v) => edit((d) => { d.rules.travel.dailyCapKm = v ?? 100; })}
              hint="Distance beyond this per day (lock timezone) counts for nothing." />
          </div>
          <p class="small muted" data-testid="travel-example" style={{ margin: 0 }}>{travelExample(R.travel.stepKm, R.travel.maxKmPerCheckin)}</p>
          <ConsequenceEditor label="For every step" value={R.travel.onStep} commands={commands} onChange={(v) => edit((d) => { d.rules.travel.onStep = v; })} />
        </Section>
      )}

      {tab === 'hunt' && (
        <Section title="Scavenger hunt" enabled={R.hunt.enabled} onToggle={(v) => edit((d) => { d.rules.hunt.enabled = v; })}
          help="Checkpoints must be found in order. The wearer only sees the hint of the current checkpoint. A 'hunt guess' at the wrong place counts as a wrong turn.">
          {placesInfo}
          <ol class="stack" style={{ paddingLeft: '18px' }}>
            {R.hunt.checkpoints.map((c, i) => (
              <li key={c.id} onClick={() => setSelected(c.id)} style={{ outline: c.id === selected ? '2px solid var(--accent)' : undefined, borderRadius: '8px', padding: '4px' }}>
                <div class="row">
                  <input class="grow" value={c.name} maxLength={60} aria-label="checkpoint name" onInput={(e) => edit((d) => { d.rules.hunt.checkpoints[i]!.name = (e.target as HTMLInputElement).value; })} />
                  <input type="number" style={{ width: '80px' }} value={c.radiusM} min={MIN_RADIUS_M} aria-label="radius" onInput={(e) => edit((d) => { d.rules.hunt.checkpoints[i]!.radiusM = Number((e.target as HTMLInputElement).value); })} />
                  <button class="link" disabled={i === 0} aria-label="move up" onClick={() => edit((d) => { const a = d.rules.hunt.checkpoints; [a[i - 1], a[i]] = [a[i]!, a[i - 1]!]; })}>↑</button>
                  <button class="link" disabled={i === R.hunt.checkpoints.length - 1} aria-label="move down" onClick={() => edit((d) => { const a = d.rules.hunt.checkpoints; [a[i + 1], a[i]] = [a[i]!, a[i + 1]!]; })}>↓</button>
                  <button class="link danger" aria-label="delete" onClick={() => edit((d) => { d.rules.hunt.checkpoints.splice(i, 1); })}>✕</button>
                </div>
                <input placeholder="Hint shown to the wearer" value={c.hint} maxLength={500} onInput={(e) => edit((d) => { d.rules.hunt.checkpoints[i]!.hint = (e.target as HTMLInputElement).value; })} />
              </li>
            ))}
          </ol>
          {R.hunt.checkpoints.length === 0 && <p class="muted small">Tap the map to add checkpoints in order.</p>}
          <div class="grid2">
            <label class="field">
              Reveal to wearer
              <select value={R.hunt.reveal} onChange={(e) => edit((d) => { d.rules.hunt.reveal = (e.target as HTMLSelectElement).value as 'hint'; })}>
                <option value="hint">Hint only</option>
                <option value="distance">Hint + hot/cold distance</option>
                <option value="map">Hint + pin on map</option>
              </select>
            </label>
            <NumberField label="Wrong-guess cooldown" suffix="minutes" min={0} value={R.hunt.wrongCooldownMinutes} onChange={(v) => edit((d) => { d.rules.hunt.wrongCooldownMinutes = v ?? 0; })} />
            <NumberField label="Time limit" suffix="minutes" optional min={10} value={R.hunt.timeLimitMinutes} onChange={(v) => edit((d) => { d.rules.hunt.timeLimitMinutes = v; })} />
            <label class="check">
              <input type="checkbox" checked={R.hunt.blockUnlockUntilComplete} onChange={(e) => edit((d) => { d.rules.hunt.blockUnlockUntilComplete = (e.target as HTMLInputElement).checked; })} />
              Block unlocking until completed
            </label>
          </div>
          <ConsequenceEditor label="Each checkpoint found" value={R.hunt.onCheckpoint} commands={commands} onChange={(v) => edit((d) => { d.rules.hunt.onCheckpoint = v; })} />
          <ConsequenceEditor label="Wrong turn (hunt guess at the wrong place)" value={R.hunt.onWrong} commands={commands} onChange={(v) => edit((d) => { d.rules.hunt.onWrong = v; })} />
          <ConsequenceEditor label="Hunt completed" value={R.hunt.onComplete} commands={commands} onChange={(v) => edit((d) => { d.rules.hunt.onComplete = v; })} />
          {R.hunt.timeLimitMinutes && <ConsequenceEditor label="Time limit exceeded" value={R.hunt.onTimeout} commands={commands} onChange={(v) => edit((d) => { d.rules.hunt.onTimeout = v; })} />}
        </Section>
      )}

      {tab === 'tracking' && (
        <>
          <div class="card stack">
            <h2>
              Background tracking
              <span class="grow" />
              <label class="check small">
                <input type="checkbox" checked={config.tracking.enabled} onChange={(e) => edit((d) => { d.tracking.enabled = (e.target as HTMLInputElement).checked; if (!d.tracking.enabled) { d.rules.curfew.enabled = false; d.tracking.liveOnly = false; } })} />
                enabled
              </label>
            </h2>
            <p class="small muted" style={{ margin: 0 }}>
              The wearer connects the free OwnTracks app (iPhone / Android), which reports the location in the background. All rules then also react to these background updates – without manual check-ins.
            </p>
            {config.tracking.enabled && (
              <>
                <div class="grid2">
                  <NumberField label="Missing signal after" suffix="minutes" min={15} value={config.tracking.heartbeatMinutes} onChange={(v) => edit((d) => { d.tracking.heartbeatMinutes = v ?? 20; })} />
                  <NumberField label="Forbidden zone counts after" suffix="minutes inside" min={0} max={120} value={config.tracking.entryConfirmMinutes} onChange={(v) => edit((d) => { d.tracking.entryConfirmMinutes = v ?? 0; })} />
                  <NumberField label="Accept delayed updates up to" suffix="minutes" min={1} value={config.tracking.maxDelayMinutes} onChange={(v) => edit((d) => { d.tracking.maxDelayMinutes = v ?? 1440; })} />
                  <label class="check">
                    <input type="checkbox" checked={config.tracking.countsAsCheckin || config.tracking.liveOnly} disabled={config.tracking.liveOnly} onChange={(e) => edit((d) => { d.tracking.countsAsCheckin = (e.target as HTMLInputElement).checked; })} />
                    Background updates in a required zone count as check-ins
                  </label>
                  <label class="check">
                    <input type="checkbox" data-testid="live-only" checked={config.tracking.liveOnly} onChange={(e) => edit((d) => { d.tracking.liveOnly = (e.target as HTMLInputElement).checked; })} />
                    Live tracking only – disable manual check-ins
                  </label>
                </div>
                <ConsequenceEditor label="When no location arrives in time (phone off, app stopped, not set up)" value={config.tracking.onHeartbeatMissed} commands={commands} onChange={(v) => edit((d) => { d.tracking.onHeartbeatMissed = v; })} />
              </>
            )}
          </div>
          <Section title="Curfew" enabled={R.curfew.enabled} onToggle={(v) => edit((d) => { d.rules.curfew.enabled = v; if (v) d.tracking.enabled = true; })}
            help="Between start and end the wearer must stay inside the selected zones. Requires background tracking.">
            <ZonePicker zones={config.zones} value={R.curfew.zoneIds} onChange={(ids) => edit((d) => { d.rules.curfew.zoneIds = ids; })} />
            <div class="grid2">
              <label class="field">
                From
                <input type="time" value={R.curfew.start} onInput={(e) => edit((d) => { d.rules.curfew.start = (e.target as HTMLInputElement).value; })} />
              </label>
              <label class="field">
                Until
                <input type="time" value={R.curfew.end} onInput={(e) => edit((d) => { d.rules.curfew.end = (e.target as HTMLInputElement).value; })} />
              </label>
              <NumberField label="Cooldown" suffix="minutes" min={0} value={R.curfew.cooldownMinutes} onChange={(v) => edit((d) => { d.rules.curfew.cooldownMinutes = v ?? 60; })} />
            </div>
            <ConsequenceEditor label="When outside during curfew" value={R.curfew.onOutside} commands={commands} onChange={(v) => edit((d) => { d.rules.curfew.onOutside = v; })} />
          </Section>
        </>
      )}

      {tab === 'anticheat' && (
        <div class="card stack">
          <h2>Anti-cheat</h2>
          <p class="small muted">Browser GPS can be faked. These checks make cheating harder but Lockation remains a trust-assisted game.</p>
          <div class="grid2">
            <NumberField label="Required accuracy" suffix="m" min={10} max={500} value={config.antiCheat.maxAccuracyM} onChange={(v) => edit((d) => { d.antiCheat.maxAccuracyM = v ?? 100; })} />
            <NumberField label="Max position age" suffix="seconds" min={10} value={config.antiCheat.maxFixAgeSeconds} onChange={(v) => edit((d) => { d.antiCheat.maxFixAgeSeconds = v ?? 120; })} />
            <NumberField label="Max plausible speed" suffix="km/h" min={5} value={config.antiCheat.maxSpeedKmh} onChange={(v) => edit((d) => { d.antiCheat.maxSpeedKmh = v ?? 200; })} />
            <NumberField label="Min time between check-ins" suffix="seconds" min={0} value={config.antiCheat.minIntervalSeconds} onChange={(v) => edit((d) => { d.antiCheat.minIntervalSeconds = v ?? 60; })} />
            <label class="field">
              Implausible speed
              <select value={config.antiCheat.onImplausible} onChange={(e) => edit((d) => { d.antiCheat.onImplausible = (e.target as HTMLSelectElement).value as 'reject'; })}>
                <option value="reject">Reject the check-in</option>
                <option value="reject_and_penalize">Reject and penalise</option>
                <option value="accept_and_verify">Accept but request a verification picture</option>
              </select>
            </label>
            <label class="field">
              Verification picture
              <select value={config.antiCheat.verificationPicture} onChange={(e) => edit((d) => { d.antiCheat.verificationPicture = (e.target as HTMLSelectElement).value as 'never'; })}>
                <option value="never">Never</option>
                <option value="always">With every check-in</option>
                <option value="random">Randomly</option>
              </select>
            </label>
            {config.antiCheat.verificationPicture === 'random' && (
              <NumberField label="Probability" suffix="%" min={0} max={100} value={Math.round(config.antiCheat.verificationProbability * 100)} onChange={(v) => edit((d) => { d.antiCheat.verificationProbability = (v ?? 0) / 100; })} />
            )}
          </div>
          {config.antiCheat.onImplausible === 'reject_and_penalize' && (
            <ConsequenceEditor label="Penalty for implausible movement" value={config.antiCheat.implausibleConsequences} commands={commands} onChange={(v) => edit((d) => { d.antiCheat.implausibleConsequences = v; })} />
          )}
          <p class="small muted">Verification pictures require the Verification Picture extension on the lock.</p>
        </div>
      )}

      {tab === 'privacy' && (
        <div class="card stack">
          <h2>Privacy</h2>
          <label class="check">
            <input type="radio" name="priv" checked={config.privacy.coordinates === 'zone_only'} onChange={() => edit((d) => { d.privacy.coordinates = 'zone_only'; })} />
            Zones only – store which zones the wearer was in, never coordinates (recommended)
          </label>
          <label class="check">
            <input type="radio" name="priv" checked={config.privacy.coordinates === 'exact'} disabled={running && config.privacy.coordinates !== 'exact'} onChange={() => edit((d) => { d.privacy.coordinates = 'exact'; })} />
            Exact – the keyholder can see each check-in on a map
          </label>
          <p class="small muted">
            The wearer sees this setting before accepting the lock and can switch to "zones only" at any time. Exact sharing cannot be enabled while the lock is running. All location history is deleted when the lock ends.
          </p>
        </div>
      )}

      <div class="card stack" data-testid="disclaimer">
        <label class="check">
          <input
            type="checkbox"
            checked={disclaimerAccepted(config)}
            onChange={(e) => {
              const on = (e.target as HTMLInputElement).checked;
              edit((d) => { d.disclaimer = on ? { version: DISCLAIMER_VERSION, acceptedAt: new Date().toISOString() } : undefined; });
            }}
          />
          <span>
            I have read the <a href="../guide/disclaimer.html" target="_blank" rel="noopener">disclaimer</a> and use Lockation at my own risk.
            Lockation is beta software without any warranty; safety always comes first.
          </span>
        </label>
      </div>

      {(!embedded || backend.demo) && (
        <div class="row">
          <button class="primary" disabled={issues.length > 0} onClick={() => save().catch(() => undefined)}>
            Save configuration
          </button>
          {backend.demo && <a class="btn" href={`index.html${location.search}`}>Open demo lock →</a>}
          {saveMsg && <span class="small">{saveMsg}</span>}
        </div>
      )}
      {embedded && !backend.demo && saveMsg && <p class="small">{saveMsg}</p>}
      <footer class="small muted">
        <a href="../guide/configuration.html" target="_blank" rel="noopener">How to configure Lockation</a> ·{' '}
        <a href="../guide/disclaimer.html" target="_blank" rel="noopener">Disclaimer</a> · Beta – use at your own risk
      </footer>
    </div>
  );
}

function Section(props: { title: string; enabled: boolean; onToggle: (v: boolean) => void; help: string; children: preact.ComponentChildren }) {
  return (
    <div class="card stack">
      <h2>
        {props.title}
        <span class="grow" />
        <label class="check small">
          <input type="checkbox" checked={props.enabled} onChange={(e) => props.onToggle((e.target as HTMLInputElement).checked)} />
          enabled
        </label>
      </h2>
      <p class="small muted" style={{ margin: 0 }}>{props.help}</p>
      {props.enabled && props.children}
    </div>
  );
}

function AddressSearch({ onPick }: { onPick: (p: { lat: number; lng: number }, name: string) => void }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<{ lat: string; lon: string; display_name: string; name?: string }[]>([]);
  const [busy, setBusy] = useState(false);
  async function search(e: Event) {
    e.preventDefault();
    if (q.trim().length < 3) return;
    setBusy(true);
    try {
      // Nominatim usage policy: max 1 request/second, only on explicit user action.
      const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q=${encodeURIComponent(q)}`, { headers: { Accept: 'application/json' } });
      setResults(await r.json());
    } catch {
      setResults([]);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form class="stack" onSubmit={search}>
      <div class="row">
        <input class="grow" placeholder="Search an address or place…" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
        <button disabled={busy}>{busy ? '…' : 'Search'}</button>
      </div>
      {results.length > 0 && (
        <ul class="plain small">
          {results.map((r) => (
            <li key={r.display_name}>
              <button type="button" class="link" onClick={() => { onPick({ lat: Number(r.lat), lng: Number(r.lon) }, r.name || r.display_name.split(',')[0]!); setResults([]); }}>
                ➕ {r.display_name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}
