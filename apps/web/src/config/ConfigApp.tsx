import {
  DISCLAIMER_VERSION,
  disclaimerAccepted,
  fmtMinutes,
  forbiddenTimings,
  MAX_PLACES,
  MIN_RADIUS_M,
  SMALL_RADIUS_HINT_M,
  MAX_RADIUS_M,
  owntracksMonitoring,
  parseConfig,
  zonesWithRole,
  type ConfigIssue,
  type KeyholderNotifyKind,
  type LockationConfig,
  type Zone,
  type ZoneRole,
} from '@lockation/core';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { LeafletMap, ZONE_COLORS, type MapCircle } from '../components/LeafletMap.js';
import { ApiError, type Backend, type CommandInfo } from '../lib/backend.js';
import { ConfigBridge } from '../lib/config-bridge.js';
import { isEmbedded } from '../lib/hash.js';
import { ackStillValid, createReachabilityChecker, needsConfirmation, statusText, unconfirmedPlaces, type ReachabilityAck, type ReachStatus } from '../lib/reachability.js';
import { ConsequenceEditor, NullableMinutesField, NumberField, OverrideField, TimeRange, WindowsEditor } from './editors.js';
import { applyRoles, droppedRolesWithSettings, forbiddenTimeline, heartbeatWarningText, toggleRole, type RoleChoice } from './helpers.js';
import { useReachability, type PlaceRef, type ReachCheck } from './useReachability.js';

type Tab = 'zones' | 'required' | 'forbidden' | 'reward' | 'travel' | 'hunt' | 'tracking' | 'notify' | 'anticheat' | 'privacy';
const TABS: { id: Tab; label: string }[] = [
  { id: 'zones', label: '🗺 Zones' },
  { id: 'required', label: '⏱ Required' },
  { id: 'forbidden', label: '⛔ Forbidden' },
  { id: 'reward', label: '🏆 Reward' },
  { id: 'travel', label: '🚶 Travel' },
  { id: 'hunt', label: '🧭 Hunt' },
  { id: 'tracking', label: '📡 Tracking' },
  { id: 'notify', label: '🔔 Notifications' },
  { id: 'anticheat', label: '🛡 Anti-cheat' },
  { id: 'privacy', label: '🔒 Privacy' },
];

const ROLE_CHIPS: { id: RoleChoice; label: string }[] = [
  { id: 'required', label: '⏱ Required' },
  { id: 'reward', label: '🏆 Reward' },
  { id: 'forbidden', label: '⛔ Forbidden' },
  { id: 'neutral', label: 'Neutral' },
];

const KEYHOLDER_SWITCHES: { id: KeyholderNotifyKind; label: string; help: string }[] = [
  { id: 'penalty', label: 'Penalty applied', help: 'Any rule added a penalty, e.g. "Bar: +1 h".' },
  { id: 'forbiddenEntered', label: 'Forbidden zone entered', help: 'At the first warning time – before the first penalty.' },
  { id: 'tracking', label: 'Background tracking', help: 'Missing signal, tracking set up or stopped.' },
  { id: 'requiredMissed', label: 'Required check-in missed', help: 'A required check-in deadline passed.' },
  { id: 'requiredDone', label: 'Required check-in done', help: 'Every successful required check-in.' },
  { id: 'hunt', label: 'Scavenger hunt', help: 'Checkpoint found, hunt completed or failed.' },
  { id: 'reward', label: 'Reward earned', help: 'The wearer earned a reward in a reward zone.' },
  { id: 'verification', label: 'Verification picture', help: 'A verification picture was requested.' },
];

const newId = (prefix: string) => `${prefix}${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;

const km = (n: number) => `${Math.round(n * 100) / 100} km`;
const rewards = (n: number) => `${n} reward${n === 1 ? '' : 's'}`;
const offOr = (v: number | null) => (v === null ? 'off' : fmtMinutes(v));
const val = (e: Event) => (e.target as HTMLInputElement).value;
const checked = (e: Event) => (e.target as HTMLInputElement).checked;

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

function zoneColor(z: Zone): string {
  if (z.roles.includes('forbidden')) return ZONE_COLORS.forbidden;
  if (z.roles.includes('required')) return ZONE_COLORS.required;
  if (z.roles.includes('reward')) return ZONE_COLORS.reward;
  return ZONE_COLORS.neutral;
}

function defaultReachCheck(): ReachCheck | null {
  return typeof fetch === 'function' ? createReachabilityChecker() : null;
}

export function ConfigApp({ backend, bridge, reachCheck }: { backend: Backend; bridge: ConfigBridge; reachCheck?: ReachCheck | null }) {
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
  const checker = useMemo(() => (reachCheck === undefined ? defaultReachCheck() : reachCheck), []);
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

  // F17 – reachability of every zone and checkpoint
  const places: PlaceRef[] = config
    ? [...config.zones, ...config.rules.hunt.checkpoints].map((p) => ({ id: p.id, lat: p.lat, lng: p.lng, radiusM: p.radiusM }))
    : [];
  const reach = useReachability(places, checker, (id, status) => {
    // Moving / resizing re-checks; a confirmation whose reasons no longer match is cleared.
    setConfig((c) => {
      if (!c) return c;
      const p = c.zones.find((z) => z.id === id) ?? c.rules.hunt.checkpoints.find((x) => x.id === id);
      if (!p?.reachabilityAck || ackStillValid(p.reachabilityAck, status)) return c;
      const d = JSON.parse(JSON.stringify(c)) as LockationConfig;
      const q = d.zones.find((z) => z.id === id) ?? d.rules.hunt.checkpoints.find((x) => x.id === id);
      if (q) delete q.reachabilityAck;
      return d;
    });
  });
  const reachRef = useRef(reach);
  reachRef.current = reach;

  const validation = useMemo(() => (config ? parseConfig(config) : undefined), [config]);
  const issues = validation && !validation.ok ? validation.issues : [];
  const unconfirmed = config ? unconfirmedPlaces([...config.zones, ...config.rules.hunt.checkpoints], reach) : [];

  async function save() {
    const cfg = configRef.current;
    if (!cfg) throw new Error('not loaded');
    const v = parseConfig(cfg);
    if (!v.ok) {
      setSaveMsg('Please fix the problems listed above.');
      throw new Error('invalid');
    }
    const open = unconfirmedPlaces([...cfg.zones, ...cfg.rules.hunt.checkpoints], reachRef.current);
    if (open.length) {
      setSaveMsg(`Safety check: please confirm or move ${open.map((p) => `"${p.name}"`).join(', ')} (${open.length === 1 ? 'it looks' : 'they look'} out of reach).`);
      throw new Error('unconfirmed_reachability');
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
  const T = config.tracking;
  const editZone = (id: string, fn: (z: Zone) => void) =>
    edit((d) => {
      const z = d.zones.find((x) => x.id === id);
      if (z) fn(z);
    });

  const isHunt = tab === 'hunt';
  const flagged = (id: string) => reach[id]?.state === 'out_of_reach';
  const circles: MapCircle[] = isHunt
    ? R.hunt.checkpoints.map((c, i) => ({ id: c.id, lat: c.lat, lng: c.lng, radiusM: c.radiusM, color: ZONE_COLORS.hunt, label: `${flagged(c.id) ? '⚠ ' : ''}${i + 1}. ${c.name}`, draggable: true, selected: c.id === selected }))
    : config.zones.map((z) => ({ id: z.id, lat: z.lat, lng: z.lng, radiusM: z.radiusM, color: zoneColor(z), label: `${flagged(z.id) ? '⚠ ' : ''}${z.name}`, draggable: true, selected: z.id === selected }));

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
        d.zones.push({ id, name: (name ?? `Zone ${d.zones.length + 1}`).slice(0, 60), lat: p.lat, lng: p.lng, radiusM: 150, roles: [], required: { intervalCheckins: true, stayWindows: [], onMissed: [], onSuccess: [], onOutsideDuringWindow: [] }, forbidden: { windows: [], onEnter: [] }, reward: { onEnter: [] } });
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

  function changeRole(z: Zone, choice: RoleChoice) {
    const next = toggleRole(z.roles, choice);
    const lost = droppedRolesWithSettings(z, next);
    if (lost.length && !confirm(`Remove the ${lost.join(' and ')} settings of "${z.name}"? Its per-zone ${lost.join('/')} settings will be lost.`)) return;
    edit((d) => {
      const i = d.zones.findIndex((x) => x.id === z.id);
      if (i < 0) return;
      d.zones[i] = applyRoles(d.zones[i]!, next);
      // Marking the first zone with a role switches the matching rule on.
      for (const r of next) if (!z.roles.includes(r) && !d.rules[r].enabled && zonesWithRole(d, r).length === 1) d.rules[r].enabled = true;
    });
  }

  function setAck(kind: 'zone' | 'checkpoint', id: string, status: ReachStatus | undefined, on: boolean) {
    edit((d) => {
      const p = kind === 'zone' ? d.zones.find((x) => x.id === id) : d.rules.hunt.checkpoints.find((x) => x.id === id);
      if (!p) return;
      if (on && status?.state === 'out_of_reach') p.reachabilityAck = { reasons: status.reasons.slice(0, 10), at: new Date().toISOString() };
      else delete p.reachabilityAck;
    });
  }

  const mapUsable = tab === 'zones' || tab === 'hunt';
  const roleZones = (r: ZoneRole) => zonesWithRole(config, r);
  const noZonesHint = (r: string) => (
    <p class="small muted" style={{ margin: 0 }}>
      No zone has the {r} role yet – mark zones as <strong>{r}</strong> in the <button class="link" onClick={() => setTab('zones')}>Zones tab</button>.
    </p>
  );
  const stayWindowsUsed = roleZones('required').some((z) => z.required.stayWindows.length > 0);
  const ruleTimings = {
    firstWarning: R.forbidden.firstWarningAfterMinutes,
    firstPenalty: R.forbidden.firstPenaltyAfterMinutes,
    repeatEvery: R.forbidden.repeatEveryMinutes,
    repeatWarning: R.forbidden.repeatWarningAfterMinutes,
  };

  return (
    <div class="container">
      <header class="top">
        <h1>📍 Lockation – configuration</h1>
        {role && <span class="badge accent">{role}</span>}
        {running && <span class="badge warn">lock running</span>}
        {backend.demo && <span class="badge">demo</span>}
      </header>
      {running && <p class="small muted" style={{ margin: 0 }}>Changes apply immediately; the wearer sees a summary of what changed.</p>}

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
      {unconfirmed.length > 0 && (
        <div class="card small" data-testid="reach-blocker">
          <strong class="warn-text">⚠ Safety check:</strong> {unconfirmed.map((p) => `"${p.name}" (${p.reasons.join(', ')})`).join('; ')} – confirm each place or move it before saving.
        </div>
      )}
      {serverIssues && serverIssues.length > 0 && (
        <div class="card small error">Server: {serverIssues.map((i) => `${i.path}: ${i.message}`).join('; ')}</div>
      )}

      <div class="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} class={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)} role="tab" aria-selected={tab === t.id}>
            {t.label}
            {(t.id === 'tracking' ? T.enabled : t.id in R && R[t.id as keyof typeof R].enabled) ? ' ●' : ''}
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
              <li key={z.id} class={z.id === selected ? 'selected' : ''} onClick={() => setSelected(z.id)} data-testid="zone-item">
                <span class="dot" style={{ background: zoneColor(z) }} />
                <input value={z.name} maxLength={60} aria-label="zone name" onInput={(e) => edit((d) => { d.zones[i]!.name = val(e); })} />
                <input type="number" style={{ width: '90px' }} min={MIN_RADIUS_M} max={MAX_RADIUS_M} value={z.radiusM} aria-label="radius" onInput={(e) => edit((d) => { d.zones[i]!.radiusM = Number(val(e)); })} />
                <span class="small muted">m</span>
                <button class="link danger" aria-label="delete zone" onClick={(e) => { e.stopPropagation(); edit((d) => { d.zones.splice(i, 1); }); }}>✕</button>
                <div class="chips full" role="group" aria-label="zone role">
                  {ROLE_CHIPS.map((c) => {
                    const on = c.id === 'neutral' ? z.roles.length === 0 : z.roles.includes(c.id);
                    return (
                      <button key={c.id} type="button" class={`chip${on ? ' active' : ''}`} aria-pressed={on} onClick={(e) => { e.stopPropagation(); changeRole(z, c.id); }}>
                        {c.label}
                      </button>
                    );
                  })}
                  <select
                    class="chip-select"
                    aria-label="zone matching"
                    value={z.matchMode ?? ''}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => edit((d) => { const v = (e.target as HTMLSelectElement).value; if (v) d.zones[i]!.matchMode = v as 'strict'; else delete d.zones[i]!.matchMode; })}
                  >
                    <option value="">Matching: default ({config.matchMode})</option>
                    <option value="lenient">Matching: lenient</option>
                    <option value="strict">Matching: strict</option>
                  </select>
                </div>
                {(z.required.stayWindows.length > 0 && z.roles.includes('required')) || (z.forbidden.windows.length > 0 && z.roles.includes('forbidden')) ? (
                  <span class="small muted full">🕑 {z.roles.includes('required') ? 'stay inside' : 'forbidden'} {(z.roles.includes('required') ? z.required.stayWindows : z.forbidden.windows).map((w) => `${w.start}–${w.end}`).join(', ')}</span>
                ) : null}
                {z.radiusM < SMALL_RADIUS_HINT_M && (
                  <span class="small muted full" data-testid="small-radius-hint">
                    ⚠ Small zone: phone GPS indoors is often less precise than {z.radiusM} m – check-ins may be judged "outside".
                  </span>
                )}
                <ReachNote status={reach[z.id]} ack={z.reachabilityAck} onAck={(on) => setAck('zone', z.id, reach[z.id], on)} />
              </li>
            ))}
          </ul>
          {config.zones.length === 0 && <p class="muted">No zones yet – tap the map or search an address.</p>}
          <p class="small muted">
            Roles: <strong>Required</strong> and/or <strong>Reward</strong>, or <strong>Forbidden</strong>, or <strong>Neutral</strong> (map only). The rule tabs list the zones of their role.
          </p>
          <div class="grid2" style={{ marginTop: '10px' }}>
            <label class="field">
              Zone matching (default)
              <select value={config.matchMode} onChange={(e) => edit((d) => { d.matchMode = (e.target as HTMLSelectElement).value as 'lenient' | 'strict'; })}>
                <option value="lenient">Lenient – position inside zone</option>
                <option value="strict">Strict – whole accuracy circle inside</option>
              </select>
            </label>
            <label class="field">
              Timezone (for time windows, quiet hours & daily limits)
              <input value={config.timezone} onInput={(e) => edit((d) => { d.timezone = val(e); })} />
            </label>
          </div>
        </div>
      )}

      {tab === 'required' && (
        <Section title="Required zones" enabled={R.required.enabled} onToggle={(v) => edit((d) => { d.rules.required.enabled = v; })}
          help={'The wearer must check in regularly inside each required zone (and/or anywhere). Required zones can also have "must stay inside" time windows.'}>
          <div class="grid2">
            <label class="check">
              <input type="checkbox" checked={R.required.anywhere} onChange={(e) => edit((d) => { d.rules.required.anywhere = checked(e); })} />
              Also require a check-in anywhere (proves the position)
            </label>
            <label class="field">
              Several required zones
              <select value={R.required.combine} onChange={(e) => edit((d) => { d.rules.required.combine = (e.target as HTMLSelectElement).value as 'each'; })}>
                <option value="each">Each zone has its own deadline (AND)</option>
                <option value="any">One shared deadline – any zone counts (OR)</option>
              </select>
            </label>
            <NumberField label="Interval (default)" suffix="minutes" min={15} value={R.required.intervalMinutes} hint={fmtMinutes(R.required.intervalMinutes)} onChange={(v) => edit((d) => { d.rules.required.intervalMinutes = v ?? 240; })} />
            <NumberField label="Grace period (default)" suffix="minutes" min={0} value={R.required.graceMinutes} onChange={(v) => edit((d) => { d.rules.required.graceMinutes = v ?? 0; })} />
            <NumberField label="Warn before a deadline" suffix="minutes, empty = off" optional min={5} value={R.required.warnBeforeMinutes} hint="Sent to the wearer's notifications (ntfy) if set up." onChange={(v) => edit((d) => { d.rules.required.warnBeforeMinutes = v; })} />
            <TimeRange label="Quiet hours (no deadline inside)" value={R.required.quietHours} onChange={(v) => edit((d) => { d.rules.required.quietHours = v; })} />
          </div>
          <ConsequenceEditor label="When a check-in is missed (all zones)" repeating="miss" value={R.required.onMissed} commands={commands} onChange={(v) => edit((d) => { d.rules.required.onMissed = v; })} />
          <ConsequenceEditor label="When checking in outside the required zones" value={R.required.onOutside} commands={commands} onChange={(v) => edit((d) => { d.rules.required.onOutside = v; })} />
          <ConsequenceEditor label="On every successful check-in (all zones)" value={R.required.onSuccess} commands={commands} onChange={(v) => edit((d) => { d.rules.required.onSuccess = v; })} />

          <h3>Required zones</h3>
          {roleZones('required').length === 0 && noZonesHint('required')}
          {R.required.combine === 'any' && roleZones('required').length > 1 && (
            <p class="small muted" style={{ margin: 0 }}>With one shared deadline the per-zone interval, grace and missed lists are not used.</p>
          )}
          {roleZones('required').map((z) => (
            <details class="zone-details" key={z.id} open={z.id === selected} data-testid="required-zone">
              <summary>
                <span class="dot" style={{ background: zoneColor(z) }} /> <strong>{z.name}</strong>{' '}
                <span class="small muted">
                  {z.required.intervalCheckins ? `every ${fmtMinutes(z.required.intervalMinutes ?? R.required.intervalMinutes)}` : 'no interval check-ins'}
                  {z.required.stayWindows.length > 0 && ` · stay inside ${z.required.stayWindows.map((w) => `${w.start}–${w.end}`).join(', ')}`}
                </span>
              </summary>
              <div class="stack">
                <label class="check">
                  <input type="checkbox" checked={z.required.intervalCheckins} onChange={(e) => editZone(z.id, (x) => { x.required.intervalCheckins = checked(e); })} />
                  Interval check-ins in this zone
                </label>
                {z.required.intervalCheckins && (
                  <div class="grid2">
                    <OverrideField label="Interval" suffix="minutes" min={15} value={z.required.intervalMinutes} inherited={R.required.intervalMinutes} format={fmtMinutes} onChange={(v) => editZone(z.id, (x) => { x.required.intervalMinutes = v; })} />
                    <OverrideField label="Grace period" suffix="minutes" min={0} value={z.required.graceMinutes} inherited={R.required.graceMinutes} format={fmtMinutes} onChange={(v) => editZone(z.id, (x) => { x.required.graceMinutes = v; })} />
                  </div>
                )}
                <div class="small"><strong>Must stay inside during</strong> <span class="muted">(e.g. 22:00–06:00 = stay home at night)</span></div>
                <WindowsEditor value={z.required.stayWindows} addLabel="Add stay-inside window" onChange={(v) => editZone(z.id, (x) => { x.required.stayWindows = v; })} />
                {z.required.stayWindows.length > 0 && !T.enabled && (
                  <div class="notice small" data-testid="needs-tracking">
                    Stay-inside windows need background tracking (the wearer's phone reports the location with OwnTracks).{' '}
                    <button onClick={() => edit((d) => { d.tracking.enabled = true; })}>Enable background tracking</button>
                  </div>
                )}
                <ConsequenceEditor label={`Extra when the check-in in ${z.name} is missed`} repeating="miss" value={z.required.onMissed} commands={commands} onChange={(v) => editZone(z.id, (x) => { x.required.onMissed = v; })} />
                <ConsequenceEditor label={`Extra on a successful check-in in ${z.name}`} value={z.required.onSuccess} commands={commands} onChange={(v) => editZone(z.id, (x) => { x.required.onSuccess = v; })} />
                {z.required.stayWindows.length > 0 && (
                  <ConsequenceEditor label={`Extra when outside ${z.name} during a stay window`} value={z.required.onOutsideDuringWindow} commands={commands} onChange={(v) => editZone(z.id, (x) => { x.required.onOutsideDuringWindow = v; })} />
                )}
              </div>
            </details>
          ))}
          {stayWindowsUsed && (
            <>
              <h3>Stay-inside windows (all zones)</h3>
              <NumberField label="At most once every" suffix="minutes" min={0} value={R.required.windowCooldownMinutes} onChange={(v) => edit((d) => { d.rules.required.windowCooldownMinutes = v ?? 60; })} />
              <ConsequenceEditor label="When outside during a stay window" value={R.required.onOutsideDuringWindow} commands={commands} onChange={(v) => edit((d) => { d.rules.required.onOutsideDuringWindow = v; })} />
            </>
          )}
        </Section>
      )}

      {tab === 'forbidden' && (
        <Section title="Forbidden zones" enabled={R.forbidden.enabled} onToggle={(v) => edit((d) => { d.rules.forbidden.enabled = v; })}
          help="Staying inside a forbidden zone escalates: a warning, then a first penalty, then a penalty at regular intervals until the wearer has left. The timeline needs background tracking – a manual check-in inside is penalised immediately.">
          {!T.enabled && <p class="small notice" style={{ margin: 0 }}>Without background tracking only manual check-ins inside are penalised (at most once per repeat interval).</p>}
          <div class="grid2">
            <NullableMinutesField label="First warning" value={R.forbidden.firstWarningAfterMinutes} fallback={2} min={0} onChange={(v) => edit((d) => { d.rules.forbidden.firstWarningAfterMinutes = v ?? null; })} />
            <NumberField label="First penalty after" suffix="minutes inside" min={0} value={R.forbidden.firstPenaltyAfterMinutes} onChange={(v) => edit((d) => { d.rules.forbidden.firstPenaltyAfterMinutes = v ?? 0; })} />
            <NumberField label="Then a penalty every" suffix="minutes, min. 5" min={5} value={R.forbidden.repeatEveryMinutes} onChange={(v) => edit((d) => { d.rules.forbidden.repeatEveryMinutes = v ?? 5; })} />
            <NullableMinutesField label="Warning after each penalty" value={R.forbidden.repeatWarningAfterMinutes} fallback={1} min={0} onChange={(v) => edit((d) => { d.rules.forbidden.repeatWarningAfterMinutes = v ?? null; })} />
          </div>
          <p class="small muted" data-testid="forbidden-timeline" style={{ margin: 0 }}>Default timeline: {forbiddenTimeline(ruleTimings)}</p>
          <ConsequenceEditor label="Penalty (all forbidden zones)" repeating="penalty" value={R.forbidden.onEnter} commands={commands} onChange={(v) => edit((d) => { d.rules.forbidden.onEnter = v; })} />

          <h3>Forbidden zones</h3>
          {roleZones('forbidden').length === 0 && noZonesHint('forbidden')}
          {roleZones('forbidden').map((z) => {
            const t = forbiddenTimings(config, z);
            const always = z.forbidden.windows.length === 0;
            return (
              <details class="zone-details" key={z.id} open={z.id === selected} data-testid="forbidden-zone">
                <summary>
                  <span class="dot" style={{ background: zoneColor(z) }} /> <strong>{z.name}</strong>{' '}
                  <span class="small muted">{always ? 'always' : `during ${z.forbidden.windows.map((w) => `${w.start}–${w.end}`).join(', ')}`}</span>
                </summary>
                <div class="stack">
                  <div class="row">
                    <label class="check">
                      <input type="radio" name={`fw-${z.id}`} checked={always} onChange={() => editZone(z.id, (x) => { x.forbidden.windows = []; })} />
                      Always forbidden
                    </label>
                    <label class="check">
                      <input type="radio" name={`fw-${z.id}`} checked={!always} onChange={() => editZone(z.id, (x) => { if (!x.forbidden.windows.length) x.forbidden.windows = [{ start: '20:00', end: '02:00' }]; })} />
                      Only during
                    </label>
                  </div>
                  {!always && <WindowsEditor value={z.forbidden.windows} onChange={(v) => editZone(z.id, (x) => { x.forbidden.windows = v; })} />}
                  <div class="grid2">
                    <NullableMinutesField label="First warning" value={z.forbidden.firstWarningAfterMinutes} fallback={2} min={0} inherited={{ value: R.forbidden.firstWarningAfterMinutes, format: offOr }} onChange={(v) => editZone(z.id, (x) => { x.forbidden.firstWarningAfterMinutes = v; })} />
                    <OverrideField label="First penalty after" suffix="minutes" min={0} value={z.forbidden.firstPenaltyAfterMinutes} inherited={R.forbidden.firstPenaltyAfterMinutes} format={fmtMinutes} onChange={(v) => editZone(z.id, (x) => { x.forbidden.firstPenaltyAfterMinutes = v; })} />
                    <OverrideField label="Then every" suffix="minutes, min. 5" min={5} value={z.forbidden.repeatEveryMinutes} inherited={R.forbidden.repeatEveryMinutes} format={fmtMinutes} onChange={(v) => editZone(z.id, (x) => { x.forbidden.repeatEveryMinutes = v; })} />
                    <NullableMinutesField label="Warning after each penalty" value={z.forbidden.repeatWarningAfterMinutes} fallback={1} min={0} inherited={{ value: R.forbidden.repeatWarningAfterMinutes, format: offOr }} onChange={(v) => editZone(z.id, (x) => { x.forbidden.repeatWarningAfterMinutes = v; })} />
                  </div>
                  <p class="small muted" style={{ margin: 0 }}>{z.name}: {forbiddenTimeline(t)}</p>
                  <ConsequenceEditor label={`Extra punishment in ${z.name} (after the common penalty)`} repeating="penalty" value={z.forbidden.onEnter} commands={commands} onChange={(v) => editZone(z.id, (x) => { x.forbidden.onEnter = v; })} />
                </div>
              </details>
            );
          })}
        </Section>
      )}

      {tab === 'reward' && (
        <Section title="Reward zones" enabled={R.reward.enabled} onToggle={(v) => edit((d) => { d.rules.reward.enabled = v; })} help="Checking in at a goal location (gym, work, …) gives a reward.">
          <div class="grid2">
            <NumberField label="Cooldown per zone (default)" suffix="minutes" min={0} value={R.reward.cooldownMinutes} onChange={(v) => edit((d) => { d.rules.reward.cooldownMinutes = v ?? 0; })} />
            <NumberField label="Max rewards per day – all zones" min={1} value={R.reward.maxPerDay} onChange={(v) => edit((d) => { d.rules.reward.maxPerDay = v ?? 1; })} />
            <NumberField label="Minimum stay (default)" suffix="minutes, 0 = immediately" min={0} value={R.reward.dwellMinutes} onChange={(v) => edit((d) => { d.rules.reward.dwellMinutes = v ?? 0; })} />
          </div>
          <ConsequenceEditor label="Reward (all reward zones)" value={R.reward.onEnter} commands={commands} onChange={(v) => edit((d) => { d.rules.reward.onEnter = v; })} />
          <h3>Reward zones</h3>
          {roleZones('reward').length === 0 && noZonesHint('reward')}
          {roleZones('reward').map((z) => (
            <details class="zone-details" key={z.id} open={z.id === selected} data-testid="reward-zone">
              <summary>
                <span class="dot" style={{ background: ZONE_COLORS.reward }} /> <strong>{z.name}</strong>{' '}
                <span class="small muted">max {z.reward.maxPerDay ?? R.reward.maxPerDay}× per day</span>
              </summary>
              <div class="stack">
                <div class="grid2">
                  <OverrideField label="Cooldown" suffix="minutes" min={0} value={z.reward.cooldownMinutes} inherited={R.reward.cooldownMinutes} format={fmtMinutes} onChange={(v) => editZone(z.id, (x) => { x.reward.cooldownMinutes = v; })} />
                  <OverrideField label="Max per day" min={1} value={z.reward.maxPerDay} inherited={R.reward.maxPerDay} onChange={(v) => editZone(z.id, (x) => { x.reward.maxPerDay = v; })} />
                  <OverrideField label="Minimum stay" suffix="minutes" min={0} value={z.reward.dwellMinutes} inherited={R.reward.dwellMinutes} format={fmtMinutes} onChange={(v) => editZone(z.id, (x) => { x.reward.dwellMinutes = v; })} />
                </div>
                <ConsequenceEditor label={`Extra reward in ${z.name}`} value={z.reward.onEnter} commands={commands} onChange={(v) => editZone(z.id, (x) => { x.reward.onEnter = v; })} />
              </div>
            </details>
          ))}
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
          help="Checkpoints are found by checking in (or walking in with background tracking). In order: only the current checkpoint counts; any order: every open checkpoint counts.">
          {placesInfo}
          <ol class="stack" style={{ paddingLeft: '18px' }}>
            {R.hunt.checkpoints.map((c, i) => (
              <li key={c.id} onClick={() => setSelected(c.id)} style={{ outline: c.id === selected ? '2px solid var(--accent)' : undefined, borderRadius: '8px', padding: '4px' }} data-testid="checkpoint-item">
                <div class="row">
                  <input class="grow" value={c.name} maxLength={60} aria-label="checkpoint name" onInput={(e) => edit((d) => { d.rules.hunt.checkpoints[i]!.name = val(e); })} />
                  <input type="number" style={{ width: '80px' }} value={c.radiusM} min={MIN_RADIUS_M} aria-label="radius" onInput={(e) => edit((d) => { d.rules.hunt.checkpoints[i]!.radiusM = Number(val(e)); })} />
                  <button class="link" disabled={i === 0} aria-label="move up" onClick={() => edit((d) => { const a = d.rules.hunt.checkpoints; [a[i - 1], a[i]] = [a[i]!, a[i - 1]!]; })}>↑</button>
                  <button class="link" disabled={i === R.hunt.checkpoints.length - 1} aria-label="move down" onClick={() => edit((d) => { const a = d.rules.hunt.checkpoints; [a[i + 1], a[i]] = [a[i]!, a[i + 1]!]; })}>↓</button>
                  <button class="link danger" aria-label="delete" onClick={() => edit((d) => { d.rules.hunt.checkpoints.splice(i, 1); })}>✕</button>
                </div>
                <input placeholder="Hint shown to the wearer" value={c.hint} maxLength={500} onInput={(e) => edit((d) => { d.rules.hunt.checkpoints[i]!.hint = val(e); })} />
                <select
                  class="chip-select"
                  aria-label="checkpoint matching"
                  value={c.matchMode ?? ''}
                  onChange={(e) => edit((d) => { const v = (e.target as HTMLSelectElement).value; if (v) d.rules.hunt.checkpoints[i]!.matchMode = v as 'strict'; else delete d.rules.hunt.checkpoints[i]!.matchMode; })}
                >
                  <option value="">Matching: default ({config.matchMode})</option>
                  <option value="lenient">Matching: lenient</option>
                  <option value="strict">Matching: strict</option>
                </select>
                <ReachNote status={reach[c.id]} ack={c.reachabilityAck} onAck={(on) => setAck('checkpoint', c.id, reach[c.id], on)} />
              </li>
            ))}
          </ol>
          {R.hunt.checkpoints.length === 0 && <p class="muted small">Tap the map to add checkpoints in order.</p>}
          <div class="grid2">
            <label class="field">
              Reveal to wearer
              <select value={R.hunt.reveal} onChange={(e) => edit((d) => { d.rules.hunt.reveal = (e.target as HTMLSelectElement).value as 'all'; })}>
                <option value="all">Hint + pin all on the map</option>
                <option value="map">Hint + pin current on the map</option>
                <option value="distance">Hint + hot/cold distance</option>
                <option value="hint">Hint only</option>
              </select>
            </label>
            <label class="field">
              Order
              <select value={R.hunt.order} onChange={(e) => edit((d) => { d.rules.hunt.order = (e.target as HTMLSelectElement).value as 'sequence'; })}>
                <option value="sequence">In order (1 → 2 → 3 …)</option>
                <option value="any">Any order</option>
              </select>
            </label>
            {R.hunt.reveal !== 'all' && (
              <NumberField label="Wrong-guess cooldown" suffix="minutes" min={0} value={R.hunt.wrongCooldownMinutes} onChange={(v) => edit((d) => { d.rules.hunt.wrongCooldownMinutes = v ?? 0; })} />
            )}
            <NumberField label="Time limit" suffix="minutes" optional min={10} value={R.hunt.timeLimitMinutes} onChange={(v) => edit((d) => { d.rules.hunt.timeLimitMinutes = v; })} />
            <label class="check">
              <input type="checkbox" checked={R.hunt.blockUnlockUntilComplete} onChange={(e) => edit((d) => { d.rules.hunt.blockUnlockUntilComplete = checked(e); })} />
              Block unlocking until completed
            </label>
          </div>
          <p class="small muted" style={{ margin: 0 }}>
            {R.hunt.reveal === 'all'
              ? 'The wearer sees all checkpoints with hints on the map (they are also synced to OwnTracks). Wrong guesses are disabled.'
              : R.hunt.reveal === 'map'
                ? 'Only the current checkpoint is shown on the map. A "hunt guess" at the wrong place counts as a wrong turn.'
                : 'Checkpoints stay secret. A "hunt guess" at the wrong place counts as a wrong turn.'}
          </p>
          <ConsequenceEditor label="Each checkpoint found" value={R.hunt.onCheckpoint} commands={commands} onChange={(v) => edit((d) => { d.rules.hunt.onCheckpoint = v; })} />
          {R.hunt.reveal !== 'all' && (
            <ConsequenceEditor label="Wrong turn (hunt guess at the wrong place)" value={R.hunt.onWrong} commands={commands} onChange={(v) => edit((d) => { d.rules.hunt.onWrong = v; })} />
          )}
          <ConsequenceEditor label="Hunt completed" value={R.hunt.onComplete} commands={commands} onChange={(v) => edit((d) => { d.rules.hunt.onComplete = v; })} />
          {R.hunt.timeLimitMinutes && <ConsequenceEditor label="Time limit exceeded" value={R.hunt.onTimeout} commands={commands} onChange={(v) => edit((d) => { d.rules.hunt.onTimeout = v; })} />}
        </Section>
      )}

      {tab === 'tracking' && (
        <div class="card stack">
          <h2>
            Background tracking
            <span class="grow" />
            <label class="check small">
              <input type="checkbox" checked={T.enabled} onChange={(e) => edit((d) => { d.tracking.enabled = checked(e); if (!d.tracking.enabled) { d.tracking.liveOnly = false; delete d.antiCheat.liveVerificationEveryHours; } })} />
              enabled
            </label>
          </h2>
          <p class="small muted" style={{ margin: 0 }}>
            The wearer connects the free OwnTracks app (iPhone / Android), which reports the location in the background. All rules then also react to these background updates – without manual check-ins.
          </p>
          {T.enabled && (
            <>
              <div class="grid2">
                <NumberField label="Missing signal after" suffix="minutes" min={15} value={T.heartbeatMinutes} hint={heartbeatWarningText(T.heartbeatMinutes, T.warnBeforeMinutes)} onChange={(v) => edit((d) => { d.tracking.heartbeatMinutes = v ?? 20; })} />
                <NumberField label="Warn before a missing-signal penalty" suffix="minutes, empty = off" optional min={10} max={Math.max(10, T.heartbeatMinutes - 1)} value={T.warnBeforeMinutes} hint="At least 10 minutes and less than the missing-signal time." onChange={(v) => edit((d) => { d.tracking.warnBeforeMinutes = v; })} />
                <NumberField label="Accept delayed updates up to" suffix="minutes" min={1} value={T.maxDelayMinutes} onChange={(v) => edit((d) => { d.tracking.maxDelayMinutes = v ?? 1440; })} />
                <label class="field">
                  OwnTracks mode
                  <select value={T.owntracksMode} onChange={(e) => edit((d) => { d.tracking.owntracksMode = (e.target as HTMLSelectElement).value as 'auto'; })}>
                    <option value="auto">Auto (currently {owntracksMonitoring(config) === 2 ? 'Move' : 'Significant'})</option>
                    <option value="move">Move – frequent updates</option>
                    <option value="significant">Significant – battery saving</option>
                  </select>
                  <span class="small muted" data-testid="owntracks-mode">
                    {owntracksMonitoring(config) === 2
                      ? 'Move mode: frequent reports, needed for short missing-signal times and forbidden-zone timelines – uses noticeably more battery.'
                      : 'Significant mode: reports only after larger movements – saves battery, but a phone lying still may report rarely.'}
                    {T.owntracksMode === 'auto' && ' Auto picks Move if the missing-signal time is under 60 min or forbidden zones are enabled.'}
                  </span>
                </label>
                <TimeRange label="Quiet hours – no missing-signal penalty or warning" value={T.quietHours} onChange={(v) => edit((d) => { d.tracking.quietHours = v; })} />
                <label class="check">
                  <input type="checkbox" checked={T.countsAsCheckin || T.liveOnly} disabled={T.liveOnly} onChange={(e) => edit((d) => { d.tracking.countsAsCheckin = checked(e); })} />
                  Background updates in a required zone count as check-ins
                </label>
                <label class="check">
                  <input type="checkbox" data-testid="live-only" checked={T.liveOnly} onChange={(e) => edit((d) => { d.tracking.liveOnly = checked(e); if (!d.tracking.liveOnly) delete d.antiCheat.liveVerificationEveryHours; })} />
                  Live tracking only – disable manual check-ins
                </label>
              </div>
              <ConsequenceEditor label="When no location arrives in time (phone off, app stopped, not set up)" repeating="missing signal" value={T.onHeartbeatMissed} commands={commands} onChange={(v) => edit((d) => { d.tracking.onHeartbeatMissed = v; })} />
            </>
          )}
        </div>
      )}

      {tab === 'notify' && (
        <div class="card stack">
          <h2>🔔 Notifications</h2>
          <p class="small muted" style={{ margin: 0 }}>
            Push notifications use the free <strong>ntfy</strong> app. Wearer and keyholder each tap <em>Set up notifications</em> on the lock page. Texts contain zone names and consequences, never coordinates.
          </p>
          <h3>Keyholder – notify me about</h3>
          <ul class="plain">
            {KEYHOLDER_SWITCHES.map((s) => (
              <li key={s.id}>
                <label class="check">
                  <input type="checkbox" data-testid={`notify-${s.id}`} checked={config.notifications.keyholder[s.id]} onChange={(e) => edit((d) => { d.notifications.keyholder[s.id] = checked(e); })} />
                  <span>
                    {s.label} <span class="small muted">– {s.help}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <h3>Wearer warnings</h3>
          <ul class="small">
            <li>Forbidden zones: {R.forbidden.enabled ? (R.forbidden.firstWarningAfterMinutes === null && R.forbidden.repeatWarningAfterMinutes === null ? 'warnings off' : 'warnings before penalties (Forbidden tab)') : 'rule off'}.</li>
            <li>Required check-ins: {R.required.enabled && R.required.warnBeforeMinutes ? `warning ${fmtMinutes(R.required.warnBeforeMinutes)} before a deadline` : 'no warning (Required tab)'}.</li>
            <li>Missing signal: {T.enabled && T.warnBeforeMinutes ? `warning ${fmtMinutes(T.warnBeforeMinutes)} before the penalty` : 'no warning (Tracking tab)'}.</li>
            <li>Rule changes during a running lock are always announced.</li>
          </ul>
        </div>
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
            <NumberField
              label="Live tracking only: random verification picture on average every"
              suffix="hours, empty = off"
              optional
              min={1}
              max={168}
              disabled={!(T.enabled && T.liveOnly)}
              value={config.antiCheat.liveVerificationEveryHours}
              hint={T.enabled && T.liveOnly ? undefined : 'Needs "Live tracking only" in the Tracking tab.'}
              onChange={(v) => edit((d) => { d.antiCheat.liveVerificationEveryHours = v; })}
            />
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
          <p class="small muted">
            Safety check: the coordinates of your zones and checkpoints (never the wearer's location) are looked up in OpenStreetMap (Overpass, Nominatim) to warn about places that are hard to reach.
          </p>
        </div>
      )}

      <div class="card stack" data-testid="disclaimer">
        <label class="check">
          <input
            type="checkbox"
            checked={disclaimerAccepted(config)}
            onChange={(e) => {
              const on = checked(e);
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
          <button class="primary" disabled={issues.length > 0 || unconfirmed.length > 0} onClick={() => save().catch(() => undefined)}>
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

/** F17 – reachability status of one zone / checkpoint with its confirmation checkbox. */
export function ReachNote({ status, ack, onAck }: { status: ReachStatus | undefined; ack: ReachabilityAck | undefined; onAck: (on: boolean) => void }) {
  if (!status || status.state === 'ok') return null;
  if (status.state === 'pending') return <span class="small muted full">{statusText(status)}</span>;
  if (status.state === 'unknown') return <span class="small muted full" data-testid="reach-unknown">ⓘ Reachability could not be checked (map service unavailable).</span>;
  if (status.state === 'partly') return <span class="small muted full" data-testid="reach-partly">ⓘ Partly {status.reasons.join(', ')}.</span>;
  const confirmed = !needsConfirmation(ack, status);
  return (
    <span class="full stack" data-testid="reach-flag" onClick={(e) => e.stopPropagation()}>
      <span class="small warn-text">⚠ Possibly out of reach: {status.reasons.join(', ')}.</span>
      <label class="check small">
        <input type="checkbox" checked={confirmed} onChange={(e) => onAck(checked(e))} />I know – this place is intentionally hard to reach
      </label>
    </span>
  );
}

function Section(props: { title: string; enabled: boolean; onToggle: (v: boolean) => void; help: string; children: preact.ComponentChildren }) {
  return (
    <div class="card stack">
      <h2>
        {props.title}
        <span class="grow" />
        <label class="check small">
          <input type="checkbox" checked={props.enabled} onChange={(e) => props.onToggle(checked(e))} />
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
        <input class="grow" placeholder="Search an address or place…" value={q} onInput={(e) => setQ(val(e))} />
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
