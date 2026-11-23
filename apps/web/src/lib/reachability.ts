/**
 * F17 – reachability safety check for zones and hunt checkpoints (config page only).
 *
 * Pure part: sample points, the Overpass query, response parsing, classification, ack handling and the save blocker.
 * Fetch part: `createReachabilityChecker` with injectable fetch / storage / clock, so it is testable without network.
 * Data sources (free, no key): OpenStreetMap Overpass (one combined query per place) and Nominatim reverse (offshore).
 * Only keyholder-chosen zone/checkpoint coordinates are sent, never wearer locations. No elevation check (decided).
 */

export interface Place {
  lat: number;
  lng: number;
  radiusM: number;
}

export type ReachStatus =
  | { state: 'pending' }
  | { state: 'ok' }
  /** Some sample points fail – info only, no confirmation needed. */
  | { state: 'partly'; reasons: string[] }
  /** All sample points fail (or a centre check failed) – must be confirmed by the keyholder. */
  | { state: 'out_of_reach'; reasons: string[] }
  /** A service could not be reached – shown, not blocking. */
  | { state: 'unknown' };

export interface ReachabilityAck {
  reasons: string[];
  at: string;
}

export const REASONS = {
  lake: 'in a lake',
  river: 'in a river',
  offshore: 'offshore',
  glacier: 'on a glacier',
  bareRock: 'on bare rock',
  cliff: 'on a cliff',
  military: 'in a military area',
  airport: 'in an airport area',
  runway: 'on a runway',
  railway: 'on a railway',
  noAccess: 'no road or path nearby',
} as const;

const REASON_ORDER: string[] = Object.values(REASONS);
const sortReasons = (r: Iterable<string>) => [...new Set(r)].sort((a, b) => REASON_ORDER.indexOf(a) - REASON_ORDER.indexOf(b));

const EARTH_M = 6_371_000;

/** Centre + 8 points on a circle at 0.7 × radius (N, NE, E, …). */
export function samplePoints(p: Place): { lat: number; lng: number }[] {
  const out = [{ lat: p.lat, lng: p.lng }];
  const d = (0.7 * p.radiusM) / EARTH_M;
  const lat1 = (p.lat * Math.PI) / 180;
  const lng1 = (p.lng * Math.PI) / 180;
  for (let i = 0; i < 8; i++) {
    const brg = (i * Math.PI) / 4;
    const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brg));
    const lng2 = lng1 + Math.atan2(Math.sin(brg) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
    out.push({ lat: (lat2 * 180) / Math.PI, lng: ((((lng2 * 180) / Math.PI + 540) % 360) - 180) });
  }
  return out;
}

/**
 * Classification: `samples[i]` = reasons why sample point i is unreachable; `centre` = reasons from checks of the
 * centre / surroundings only (offshore, cliff, runway, railway, no path) – these always flag the place.
 */
export function classifyReachability(samples: string[][], centre: string[] = []): ReachStatus {
  const failing = samples.filter((s) => s.length > 0);
  if (centre.length || (samples.length > 0 && failing.length === samples.length)) {
    return { state: 'out_of_reach', reasons: sortReasons([...centre, ...failing.flat()]) };
  }
  if (failing.length) return { state: 'partly', reasons: sortReasons(failing.flat()) };
  return { state: 'ok' };
}

const fx = (n: number) => n.toFixed(6);

/** One combined Overpass query: area membership per sample point plus centre checks. */
export function overpassQuery(p: Place): string {
  const lines = ['[out:json][timeout:25];'];
  samplePoints(p).forEach((s, i) => {
    lines.push(`is_in(${fx(s.lat)},${fx(s.lng)})->.a${i};`, `make sample n="${i}";out;`, `area.a${i}[~"^(natural|water|waterway|landuse|aeroway)$"~"."];out tags;`);
  });
  const c = `${fx(p.lat)},${fx(p.lng)}`;
  lines.push(
    'make centre;out;',
    `way(around:15,${c})[natural=cliff];out tags;`,
    `way(around:25,${c})[aeroway=runway];out tags;`,
    `way(around:8,${c})[railway=rail];out tags;`,
    'make access;out;',
    `way(around:${Math.round(p.radiusM + 100)},${c})[highway];out count;`,
  );
  return lines.join('\n');
}

interface OsmElement {
  type: string;
  tags?: Record<string, string>;
}

/** Reason for one area an (inner) sample point lies in, if it makes the point unreachable. */
export function areaReason(tags: Record<string, string>): string | undefined {
  if (tags.natural === 'water' || tags.water || tags.waterway === 'riverbank') {
    return tags.water === 'river' || tags.water === 'canal' || tags.waterway === 'riverbank' ? REASONS.river : REASONS.lake;
  }
  if (tags.natural === 'glacier') return REASONS.glacier;
  if (tags.natural === 'bare_rock') return REASONS.bareRock;
  if (tags.landuse === 'military') return REASONS.military;
  if (tags.aeroway === 'aerodrome') return REASONS.airport;
  return undefined;
}

/** Parses the Overpass JSON of `overpassQuery` into per-sample and centre reasons. */
export function parseOverpass(json: unknown, sampleCount = 9): { samples: string[][]; centre: string[] } {
  const elements = ((json as { elements?: OsmElement[] })?.elements ?? []) as OsmElement[];
  if (!Array.isArray(elements)) throw new Error('unexpected Overpass response');
  const samples: string[][] = Array.from({ length: sampleCount }, () => []);
  const centre: string[] = [];
  let section: 'sample' | 'centre' | 'access' | undefined;
  let idx = -1;
  let sawAccess = false;
  for (const e of elements) {
    if (e.type === 'sample') {
      section = 'sample';
      idx = Number(e.tags?.n ?? -1);
      continue;
    }
    if (e.type === 'centre') {
      section = 'centre';
      continue;
    }
    if (e.type === 'access') {
      section = 'access';
      continue;
    }
    const tags = e.tags ?? {};
    if (section === 'sample' && e.type === 'area' && samples[idx]) {
      const r = areaReason(tags);
      if (r && !samples[idx]!.includes(r)) samples[idx]!.push(r);
    } else if (section === 'centre' && e.type === 'way') {
      if (tags.natural === 'cliff') centre.push(REASONS.cliff);
      else if (tags.aeroway === 'runway') centre.push(REASONS.runway);
      else if (tags.railway === 'rail') centre.push(REASONS.railway);
    } else if (section === 'access' && e.type === 'count') {
      sawAccess = true;
      const total = Number(tags.ways ?? tags.total ?? 0);
      if (!(total > 0)) centre.push(REASONS.noAccess);
    }
  }
  if (!sawAccess) throw new Error('incomplete Overpass response');
  return { samples, centre: sortReasons(centre) };
}

/** Nominatim reverse geocoding at zoom 10: no land result → the point is offshore. */
export function isOffshore(json: unknown): boolean {
  const j = json as { error?: unknown; address?: { country_code?: string } } | null;
  if (!j || typeof j !== 'object') return false;
  if (j.error) return true;
  return !j.address?.country_code;
}

// ---------- confirmation ----------

const sameReasons = (a: readonly string[], b: readonly string[]) => a.length === b.length && sortReasons(a).every((r, i) => r === sortReasons(b)[i]);

/** Whether an existing confirmation still matches the latest check (pending / failed checks keep it). */
export function ackStillValid(ack: ReachabilityAck | undefined, status: ReachStatus | undefined): boolean {
  if (!ack) return false;
  if (!status || status.state === 'pending' || status.state === 'unknown') return true;
  return status.state === 'out_of_reach' && sameReasons(ack.reasons, status.reasons);
}

export function needsConfirmation(ack: ReachabilityAck | undefined, status: ReachStatus | undefined): boolean {
  return status?.state === 'out_of_reach' && !ackStillValid(ack, status);
}

/** Flagged places that are not (or no longer) confirmed – saving is blocked while this list is not empty. */
export function unconfirmedPlaces<T extends { id: string; name: string; reachabilityAck?: ReachabilityAck }>(
  places: readonly T[],
  statuses: Readonly<Record<string, ReachStatus | undefined>>,
): { id: string; name: string; reasons: string[] }[] {
  return places.flatMap((p) => {
    const s = statuses[p.id];
    return s?.state === 'out_of_reach' && needsConfirmation(p.reachabilityAck, s) ? [{ id: p.id, name: p.name, reasons: s.reasons }] : [];
  });
}

export function statusText(s: ReachStatus | undefined): string {
  if (!s) return '';
  switch (s.state) {
    case 'pending':
      return 'checking reachability…';
    case 'ok':
      return '';
    case 'partly':
      return `partly ${s.reasons.join(', ')}`;
    case 'out_of_reach':
      return `out of reach: ${s.reasons.join(', ')}`;
    case 'unknown':
      return 'reachability could not be checked';
  }
}

// ---------- fetch part ----------

export interface CheckerDeps {
  fetch?: typeof fetch;
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  overpassUrl?: string;
  nominatimUrl?: string;
}

export const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
export const NOMINATIM_REVERSE_URL = 'https://nominatim.openstreetmap.org/reverse';
const CACHE_PREFIX = 'lockation-reach:';

export function cacheKey(p: Place): string {
  return `${CACHE_PREFIX}${p.lat.toFixed(4)},${p.lng.toFixed(4)},${Math.round(p.radiusM)}`;
}

export function createReachabilityChecker(deps: CheckerDeps = {}) {
  const doFetch = deps.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const now = deps.now ?? (() => Date.now());
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const storage = deps.storage === undefined ? safeSessionStorage() : deps.storage;
  let lastNominatim = -Infinity;
  let queue: Promise<unknown> = Promise.resolve();

  /** Nominatim usage policy: at most one request per second (serialised). */
  function nominatim(lat: number, lng: number): Promise<unknown> {
    const run = async () => {
      const wait = lastNominatim + 1100 - now();
      if (wait > 0) await sleep(wait);
      lastNominatim = now();
      const url = `${deps.nominatimUrl ?? NOMINATIM_REVERSE_URL}?format=jsonv2&zoom=10&lat=${fx(lat)}&lon=${fx(lng)}`;
      const r = await doFetch(url, { headers: { Accept: 'application/json' } });
      if (!r.ok) throw new Error(`Nominatim ${r.status}`);
      return r.json();
    };
    const p = queue.then(run, run);
    queue = p.catch(() => undefined);
    return p;
  }

  async function overpass(query: string): Promise<unknown> {
    const r = await doFetch(deps.overpassUrl ?? OVERPASS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(query)}`,
    });
    if (!r.ok) throw new Error(`Overpass ${r.status}`);
    return r.json();
  }

  return async function check(p: Place): Promise<ReachStatus> {
    const key = cacheKey(p);
    try {
      const cached = storage?.getItem(key);
      if (cached) return JSON.parse(cached) as ReachStatus;
    } catch {
      /* ignore */
    }
    try {
      const [ov, rev] = await Promise.all([overpass(overpassQuery(p)), nominatim(p.lat, p.lng)]);
      const { samples, centre } = parseOverpass(ov);
      const result = classifyReachability(samples, isOffshore(rev) ? [...centre, REASONS.offshore] : centre);
      try {
        storage?.setItem(key, JSON.stringify(result));
      } catch {
        /* ignore */
      }
      return result;
    } catch {
      return { state: 'unknown' };
    }
  };
}

function safeSessionStorage(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}
