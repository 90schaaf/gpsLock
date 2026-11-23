/**
 * F14 – OwnTracks integration helpers (pure, shared by worker and demo).
 * Formats: https://owntracks.org/booklet/tech/json/ and https://owntracks.org/booklet/tech/http/
 */
import type { LockationConfig } from './config.js';
import type { TrackedInput } from './engine.js';

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
}

/** `.otrc` configuration for HTTP mode (mode 3), significant-changes monitoring (1). */
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
    monitoring: 1,
    locatorDisplacement: 100,
    locatorInterval: 300,
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

/** Zones as OwnTracks waypoints. Hunt checkpoints are never included (F14 AC9). */
export function owntracksWaypoints(config: LockationConfig) {
  const waypoints = config.zones.map((z) => ({
    _type: 'waypoint',
    desc: z.name,
    lat: z.lat,
    lon: z.lng,
    rad: Math.round(z.radiusM),
    // `tst` is the unique key of a waypoint in the apps – keep it stable per zone id.
    tst: 1_600_000_000 + (fnv1a(z.id) % 100_000_000),
  }));
  const hash = fnv1a(JSON.stringify(waypoints)).toString(36);
  return {
    hash,
    command: { _type: 'cmd', action: 'setWaypoints', waypoints: { _type: 'waypoints', waypoints } },
  };
}

interface OwnTracksMessage {
  _type?: string;
  lat?: unknown;
  lon?: unknown;
  acc?: unknown;
  tst?: unknown;
  event?: unknown;
  desc?: unknown;
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
  if (m._type === 'location') return fix ? { fix } : undefined;
  if (m._type === 'transition') {
    const event = m.event === 'enter' || m.event === 'leave' ? m.event : undefined;
    if (!event) return fix ? { fix } : undefined;
    const zone = typeof m.desc === 'string' ? config.zones.find((z) => z.name === m.desc) : undefined;
    return { fix, transition: { event, zoneId: zone?.id, at: Math.round(tst * 1000) } };
  }
  return undefined;
}
