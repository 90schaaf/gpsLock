import {
  DISCLAIMER_VERSION,
  disclaimerAccepted,
  MAX_RADIUS_M,
  MIN_RADIUS_M,
  parseConfig,
  type ConfigIssue,
  type LockationConfig,
  type Zone,
} from '@lockation/core';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { LeafletMap, ZONE_COLORS, type MapCircle } from '../components/LeafletMap.js';
import { ApiError, type Backend, type CommandInfo } from '../lib/backend.js';
import { ConfigBridge } from '../lib/config-bridge.js';
import { isEmbedded } from '../lib/hash.js';
import { ackStillValid, createReachabilityChecker, needsConfirmation, unconfirmedPlaces } from '../lib/reachability.js';
import { countByTab, issueLabel, issuesForTab, IssuesContext } from './issues.js';
import { checked, IssueSummary, newId, placesFull as placesLimitReached, TABS, val, zoneColor, type Tab, type TabProps } from './shared.js';
import { useReachability, type PlaceRef, type ReachCheck } from './useReachability.js';
import { AntiCheatTab } from './tabs/AntiCheatTab.js';
import { FileTab } from './tabs/FileTab.js';
import { ForbiddenTab } from './tabs/ForbiddenTab.js';
import { HuntTab } from './tabs/HuntTab.js';
import { NotificationsTab } from './tabs/NotificationsTab.js';
import { PrivacyTab } from './tabs/PrivacyTab.js';
import { RequiredTab } from './tabs/RequiredTab.js';
import { RewardTab } from './tabs/RewardTab.js';
import { TrackingTab } from './tabs/TrackingTab.js';
import { TravelTab } from './tabs/TravelTab.js';
import { ZonesTab } from './tabs/ZonesTab.js';

export { ReachNote } from './shared.js';
export { travelExample } from './tabs/TravelTab.js';
export { importConfigText, SettingsFile } from './tabs/FileTab.js';
export { checkinMode, setCheckinMode, type CheckinMode } from './tabs/TrackingTab.js';

const TAB_COMPONENTS: Record<Tab, (p: TabProps) => preact.JSX.Element> = {
  zones: ZonesTab,
  required: RequiredTab,
  forbidden: ForbiddenTab,
  reward: RewardTab,
  travel: TravelTab,
  hunt: HuntTab,
  tracking: TrackingTab,
  notify: NotificationsTab,
  anticheat: AntiCheatTab,
  privacy: PrivacyTab,
  file: FileTab,
};

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
  const issueCount = countByTab(issues);
  const unconfirmed = config ? unconfirmedPlaces([...config.zones, ...config.rules.hunt.checkpoints], reach) : [];

  async function save() {
    const cfg = configRef.current;
    if (!cfg) throw new Error('not loaded');
    const v = parseConfig(cfg);
    if (!v.ok) {
      setSaveMsg('Please fix the problems marked on the tabs.');
      throw new Error('invalid');
    }
    const open = unconfirmedPlaces([...cfg.zones, ...cfg.rules.hunt.checkpoints], reachRef.current);
    if (open.length) {
      setSaveMsg(`Safety check: please confirm or move ${open.map((p) => `"${p.name}"`).join(', ')} (${open.length === 1 ? 'it looks' : 'they look'} out of reach).`);
      throw new Error('unconfirmed_reachability');
    }
    if (!disclaimerAccepted(v.config)) {
      setSaveMsg('Please accept the disclaimer on the Zones tab before saving.');
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

  const accepted = disclaimerAccepted(config);
  const tabIssues = issuesForTab(issues, tab, config);
  const placesFull = placesLimitReached(config);

  function addAt(p: { lat: number; lng: number }, name?: string) {
    if (!accepted) {
      setTab('zones'); // shows the disclaimer
      return;
    }
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
        d.zones.push({ id, name: (name ?? `Zone ${d.zones.length + 1}`).slice(0, 60), lat: p.lat, lng: p.lng, radiusM: 150, roles: [], required: { intervalCheckins: true, stayWindows: [], onMissed: [], onSuccess: [], onOutsideDuringWindow: [] }, forbidden: { windows: [], onEnter: [] }, reward: { onEnter: [] }, actions: { onEnter: [], onLeave: [], minStayMinutes: 0, cooldownMinutes: 0 } });
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

  /** One confirmation for all currently flagged places. */
  function ackAll() {
    const at = new Date().toISOString();
    edit((d) => {
      for (const p of [...d.zones, ...d.rules.hunt.checkpoints]) {
        const st = reach[p.id];
        if (st?.state === 'out_of_reach' && needsConfirmation(p.reachabilityAck, st)) p.reachabilityAck = { reasons: st.reasons.slice(0, 10), at };
      }
    });
  }

  const mapUsable = tab === 'zones' || tab === 'hunt';
  const TabContent = TAB_COMPONENTS[tab];
  const tabProps: TabProps = { config, edit, editZone, commands, reach, selected, setSelected, setTab, running };

  return (
    <IssuesContext.Provider value={issues}>
    <div class="container">
      <header class="top">
        <h1>📍 Lockation – configuration</h1>
        {role && <span class="badge accent">{role}</span>}
        {running && <span class="badge warn">lock running</span>}
        {backend.demo && <span class="badge">demo</span>}
      </header>
      {running && <p class="small muted" style={{ margin: 0 }}>Changes apply immediately; the wearer sees a summary of what changed.</p>}

      {unconfirmed.length > 0 && (
        <div class="card small stack" data-testid="reach-blocker">
          <strong class="warn-text">⚠ Safety check – these places may be out of reach:</strong>
          <ul class="plain">
            {unconfirmed.map((p) => (
              <li key={p.id}>
                <strong>{p.name}</strong>: {p.reasons.join(', ')}
              </li>
            ))}
          </ul>
          <label class="check">
            <input type="checkbox" checked={false} data-testid="reach-ack-all" onChange={(e) => { if (checked(e)) ackAll(); }} />
            I know – {unconfirmed.length === 1 ? 'this place is' : 'these places are'} intentionally hard to reach
          </label>
          <span class="muted">Or move the place. Saving is possible once confirmed.</span>
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
            {issueCount[t.id] ? <span class="badge bad tab-issues" data-testid={`tab-issues-${t.id}`}>⚠ {issueCount[t.id]}</span> : null}
          </button>
        ))}
      </div>

      {tab === 'zones' && !accepted && (
        <div class="card stack" data-testid="disclaimer">
          <h2>⚠️ Before you start</h2>
          <label class="check">
            <input
              type="checkbox"
              checked={false}
              onChange={(e) => {
                if (!checked(e)) return;
                edit((d) => { d.disclaimer = { version: DISCLAIMER_VERSION, acceptedAt: new Date().toISOString() }; });
              }}
            />
            <span>
              I have read the <a href="../guide/disclaimer.html" target="_blank" rel="noopener">disclaimer</a> and use Lockation at my own risk.
              Lockation is beta software without any warranty; safety always comes first.
            </span>
          </label>
          <p class="small muted" style={{ margin: 0 }}>Accept the disclaimer to add zones.</p>
        </div>
      )}
      {tab === 'hunt' && !accepted && (
        <div class="notice small" data-testid="disclaimer-hint">Accept the disclaimer on the <button class="link" onClick={() => setTab('zones')}>Zones</button> tab to add checkpoints.</div>
      )}

      {mapUsable && (
        <>
          {accepted && <AddressSearch onPick={(p, name) => { addAt(p, name); setFitKey(newId('f')); }} />}
          <LeafletMap
            circles={circles}
            fitKey={`${fitKey}-${tab}`}
            height="360px"
            onClick={accepted ? addAt : undefined}
            onCircleClick={setSelected}
            onCircleMove={move}
          />
          <p class="small muted" style={{ margin: 0 }}>
            {accepted ? `Tap the map to add a ${isHunt ? 'checkpoint' : 'zone'}; ` : ''}Drag the handle to move it. Radius {MIN_RADIUS_M} m – {MAX_RADIUS_M / 1000} km.
          </p>
        </>
      )}

      {tabIssues.length > 0 && (
        <div class="card stack issue-card" data-testid="tab-issues">
          <strong class="error">Please fix on this tab:</strong>
          <ul class="issues">
            {tabIssues.map((i) => {
              const where = issueLabel(i.path, config);
              return (
                <li key={i.path + i.message}>
                  {where && <strong>{where}: </strong>}
                  {i.message}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <TabContent {...tabProps} />

      {(!embedded || backend.demo) && (
        <div class="row">
          <button class="primary" disabled={issues.length > 0 || unconfirmed.length > 0} onClick={() => save().catch(() => undefined)}>
            Save configuration
          </button>
          {backend.demo && <a class="btn" href={`index.html${location.search}`}>Open demo lock →</a>}
          {saveMsg && <span class="small">{saveMsg}</span>}
          {issues.length > 0 && <IssueSummary count={issueCount} onGo={setTab} />}
        </div>
      )}
      {embedded && !backend.demo && saveMsg && <p class="small">{saveMsg}</p>}
      {embedded && !backend.demo && issues.length > 0 && <IssueSummary count={issueCount} onGo={setTab} />}
      <footer class="small muted">
        <a href="../guide/configuration.html" target="_blank" rel="noopener">How to configure Lockation</a> ·{' '}
        <a href="../guide/disclaimer.html" target="_blank" rel="noopener">Disclaimer</a> · Beta – use at your own risk
      </footer>
    </div>
    </IssuesContext.Provider>
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
