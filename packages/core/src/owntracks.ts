/**
 * F14 – OwnTracks integration helpers (pure, shared by worker and demo).
 * Formats: https://owntracks.org/booklet/tech/json/ and https://owntracks.org/booklet/tech/http/
 */
import type { LockationConfig } from './config.js';
import { type TrackedInput, visibleCheckpoints } from './engine.js';
import type { LockationState } from './state.js';

/** FNV-1a 32 bit hash. */
export function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export interface OwnTracksConfigOptions {
  url: string;
  username: string;
  password: string;
  /** 1 = significant changes (battery saving), 2 = move (frequent). Default 1. */
  monitoring?: 1 | 2;
  /** Report interval in seconds (move mode). Default 300. */
  locatorInterval?: number;
}

/** `.otrc` configuration for HTTP mode (mode 3); monitoring 1 (significant) or 2 (move). */
export function owntracksConfiguration(o: OwnTracksConfigOptions) {
  return {
    _type: 'configuration',
    mode: 3,
    url: o.url,
    auth: true,
    username: o.username,
    password: o.password,
    deviceId: 'lockation',
    tid: 'LO',
    monitoring: o.monitoring ?? 1,
    locatorDisplacement: 100,
    locatorInterval: o.locatorInterval ?? 300,
    extendedData: false,
    // Needed so the app accepts the `setWaypoints` command we return in HTTP responses.
    cmd: true,
  };
}

function toBase64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** Provisioning link understood by the OwnTracks apps (iOS + Android). */
export function owntracksConfigLink(o: OwnTracksConfigOptions): string {
  return `owntracks:///config?inline=${encodeURIComponent(toBase64(JSON.stringify(owntracksConfiguration(o))))}`;
}

export const CHECKPOINT_PREFIX = 'Hunt ';

/** Waypoint name of a hunt checkpoint ("Hunt 3: Fountain"), distinct from zone names. */
export function checkpointWaypointName(index: number, name: string): string {
  return `${CHECKPOINT_PREFIX}${index + 1}: ${name}`;
}

/**
 * Zones and the **visible** hunt checkpoints as OwnTracks waypoints (F14 AC9: never a checkpoint the wearer can't see).
 * Found checkpoints are dropped, so the hash changes and the next response pushes the new list.
 */
export function owntracksWaypoints(config: LockationConfig, state?: LockationState) {
  const waypoints = config.zones.map((z) => ({
    _type: 'waypoint',
    desc: z.name,
    lat: z.lat,
    lon: z.lng,
    rad: Math.round(z.radiusM),
    // `tst` is the unique key of a waypoint in the apps – keep it stable per zone id.
    tst: 1_600_000_000 + (fnv1a(z.id) % 100_000_000),
  }));
  const reveal = config.rules.hunt.reveal;
  if (state && (reveal === 'all' || reveal === 'map')) {
    for (const v of visibleCheckpoints(config, state)) {
      if (v.status === 'found' || v.status === 'upcoming') continue;
      waypoints.push({
        _type: 'waypoint',
        desc: checkpointWaypointName(v.index, v.cp.name),
        lat: v.cp.lat,
        lon: v.cp.lng,
        rad: Math.round(v.cp.radiusM),
        tst: 1_700_000_000 + (fnv1a(`cp:${v.cp.id}`) % 100_000_000),
      });
    }
  }
  const hash = fnv1a(JSON.stringify(waypoints)).toString(36);
  return {
    hash,
    command: { _type: 'cmd', action: 'setWaypoints', waypoints: { _type: 'waypoints', waypoints } },
  };
}

/** Remote configuration change (e.g. switch between move and significant mode without pairing again). */
export function owntracksSetMonitoring(monitoring: 1 | 2, locatorInterval?: number) {
  return { _type: 'cmd', action: 'setConfiguration', configuration: { _type: 'configuration', monitoring, ...(locatorInterval ? { locatorInterval } : {}) } };
}

interface OwnTracksMessage {
  _type?: string;
  lat?: unknown;
  lon?: unknown;
  acc?: unknown;
  tst?: unknown;
  event?: unknown;
  desc?: unknown;
  t?: unknown;
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/**
 * Convert an OwnTracks message to a tracked observation.
 * Returns undefined for message types we ignore (waypoint, card, lwt, status, …).
 */
export function parseOwnTracks(body: unknown, config: LockationConfig): TrackedInput | undefined {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined;
  const m = body as OwnTracksMessage;
  const lat = num(m.lat);
  const lng = num(m.lon);
  const tst = num(m.tst);
  if (tst === undefined) return undefined;
  const fix =
    lat !== undefined && lng !== undefined && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
      ? { lat, lng, accuracy: num(m.acc) ?? 0, timestamp: Math.round(tst * 1000) }
      : undefined;
  // OwnTracks trigger "u" = the user tapped publish (manual send).
  if (m._type === 'location') return fix ? { fix, ...(m.t === 'u' ? { manual: true } : {}) } : undefined;
  if (m._type === 'transition') {
    const event = m.event === 'enter' || m.event === 'leave' ? m.event : undefined;
    if (!event) return fix ? { fix } : undefined;
    const desc = typeof m.desc === 'string' ? m.desc : undefined;
    const zone = desc ? config.zones.find((z) => z.name === desc) : undefined;
    let checkpointId: string | undefined;
    if (!zone && desc?.startsWith(CHECKPOINT_PREFIX)) {
      const cps = config.rules.hunt.checkpoints;
      checkpointId = cps.find((c, i) => checkpointWaypointName(i, c.name) === desc)?.id;
    }
    return { fix, transition: { event, zoneId: zone?.id, checkpointId, at: Math.round(tst * 1000) } };
  }
  return undefined;
}
