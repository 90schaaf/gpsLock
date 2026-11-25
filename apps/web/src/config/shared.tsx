/** Pieces shared by the config page shell and its tabs. */
import { fmtMinutes, MAX_PLACES, type LockationConfig, type Zone } from '@lockation/core';
import { ZONE_COLORS } from '../components/LeafletMap.js';
import type { CommandInfo } from '../lib/backend.js';
import { needsConfirmation, statusText, type ReachabilityAck, type ReachStatus } from '../lib/reachability.js';
import type { Tab } from './issues.js';

export type { Tab };

export const TABS: { id: Tab; label: string }[] = [
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
  { id: 'file', label: '💾 Import / Export' },
];

export type Edit = (fn: (d: LockationConfig) => void) => void;

/** Everything a tab needs from the config page shell. */
export interface TabProps {
  config: LockationConfig;
  /** Applies a change to a deep copy of the configuration. */
  edit: Edit;
  /** Applies a change to one zone (by id). */
  editZone: (id: string, fn: (z: Zone) => void) => void;
  commands: CommandInfo[];
  reach: Record<string, ReachStatus>;
  selected: string | undefined;
  setSelected: (id: string) => void;
  setTab: (t: Tab) => void;
  /** A lock is running for this configuration. */
  running: boolean;
  /** Demo-only actions (undefined outside the demo). */
  demo?: { redrawHuntRoute(): Promise<{ drawn: boolean; names: string[] }> };
}

export const newId = (prefix: string) => `${prefix}${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;

export const offOr = (v: number | null) => (v === null ? 'off' : fmtMinutes(v));
export const val = (e: Event) => (e.target as HTMLInputElement).value;
export const checked = (e: Event) => (e.target as HTMLInputElement).checked;

export function zoneColor(z: Zone): string {
  if (z.roles.includes('forbidden')) return ZONE_COLORS.forbidden;
  if (z.roles.includes('required')) return ZONE_COLORS.required;
  if (z.roles.includes('reward')) return ZONE_COLORS.reward;
  return ZONE_COLORS.neutral;
}

/** Sets or clears the reachability confirmation of one zone / checkpoint. */
export function setAck(edit: Edit, kind: 'zone' | 'checkpoint', id: string, status: ReachStatus | undefined, on: boolean) {
  edit((d) => {
    const p = kind === 'zone' ? d.zones.find((x) => x.id === id) : d.rules.hunt.checkpoints.find((x) => x.id === id);
    if (!p) return;
    if (on && status?.state === 'out_of_reach') p.reachabilityAck = { reasons: status.reasons.slice(0, 10), at: new Date().toISOString() };
    else delete p.reachabilityAck;
  });
}

export function placesFull(config: LockationConfig): boolean {
  return config.zones.length + config.rules.hunt.checkpoints.length >= MAX_PLACES;
}

/** "n / max places used" line of the Zones and Hunt tabs. */
export function PlacesInfo({ config }: { config: LockationConfig }) {
  const placeCount = config.zones.length + config.rules.hunt.checkpoints.length;
  const full = placeCount >= MAX_PLACES;
  return (
    <p class={`small ${full ? 'warn-text' : 'muted'}`} data-testid="place-count" style={{ margin: 0 }}>
      {placeCount} / {MAX_PLACES} places used (zones + hunt checkpoints).
      {full && ' Limit reached – delete a zone or checkpoint to add a new one.'}
    </p>
  );
}

/** Shown on a rule tab while no zone has its role. */
export function NoZonesHint({ role, setTab }: { role: string; setTab: (t: Tab) => void }) {
  return (
    <p class="small muted" style={{ margin: 0 }}>
      No zone has the {role} role yet – mark zones as <strong>{role}</strong> in the <button class="link" onClick={() => setTab('zones')}>Zones tab</button>.
    </p>
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
      <span class="small warn-text">
        ⚠ Possibly out of reach: {status.reasons.join(', ')}.{' '}
        {confirmed ? (
          <span class="muted">
            Confirmed as intentional ·{' '}
            <button class="link" onClick={() => onAck(false)}>
              undo
            </button>
          </span>
        ) : (
          <span class="muted">Confirm at the top of the page.</span>
        )}
      </span>
    </span>
  );
}

export function Section(props: { title: string; enabled: boolean; onToggle: (v: boolean) => void; help: string; children: preact.ComponentChildren }) {
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

/** Short note next to Save: how many problems, with links to the affected tabs. */
export function IssueSummary({ count, onGo }: { count: Partial<Record<Tab, number>>; onGo: (t: Tab) => void }) {
  const tabs = TABS.filter((t) => count[t.id]);
  const total = tabs.reduce((a, t) => a + (count[t.id] ?? 0), 0);
  return (
    <span class="small error" data-testid="issue-summary">
      {total} problem{total === 1 ? '' : 's'} to fix:{' '}
      {tabs.map((t, i) => (
        <span key={t.id}>
          {i > 0 && ', '}
          <button class="link" onClick={() => onGo(t.id)}>
            {t.label} ({count[t.id]})
          </button>
        </span>
      ))}
    </span>
  );
}
