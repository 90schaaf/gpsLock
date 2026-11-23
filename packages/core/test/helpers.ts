import {
  evaluateCheckin,
  initialState,
  parseConfig,
  type CheckinPurpose,
  type Fix,
  type LockationConfig,
  type LockationConfigInput,
  type LockationState,
} from '../src/index.js';

export const HOME = { lat: 47.3769, lng: 8.5417 }; // Zürich HB
export const GYM = { lat: 47.3667, lng: 8.55 }; // ~1.3 km away
export const BAR = { lat: 47.39, lng: 8.515 }; // ~2.5 km away
export const BERN = { lat: 46.948, lng: 7.4474 };
export const NEW_YORK = { lat: 40.7128, lng: -74.006 };

export const T0 = new Date('2026-06-01T10:00:00Z');

/** Move a point north by `m` metres. */
export function north(p: { lat: number; lng: number }, m: number) {
  return { lat: p.lat + m / 111_195, lng: p.lng };
}

export function cfg(input: LockationConfigInput): LockationConfig {
  const res = parseConfig({ timezone: 'Europe/Zurich', ...input });
  if (!res.ok) throw new Error(JSON.stringify(res.issues));
  return res.config;
}

export function fixAt(p: { lat: number; lng: number }, at: Date, accuracy = 10): Fix {
  return { ...p, accuracy, timestamp: at.getTime() };
}

export const minutes = (d: Date, m: number) => new Date(d.getTime() + m * 60_000);

/** Run a sequence of check-ins, returning the last result and the state. */
export class Sim {
  state: LockationState;
  n = 0;
  constructor(
    public config: LockationConfig,
    start = T0,
  ) {
    this.state = initialState(config, start);
  }
  checkin(p: { lat: number; lng: number }, at: Date, opts: { accuracy?: number; purpose?: CheckinPurpose; rng?: () => number } = {}) {
    const res = evaluateCheckin(
      this.config,
      this.state,
      fixAt(p, at, opts.accuracy ?? 10),
      { now: at, sessionId: 's1', evalId: `c${++this.n}`, rng: opts.rng ?? (() => 0.99) },
      opts.purpose ?? 'general',
    );
    this.state = res.state;
    return res;
  }
}

export const zones = {
  home: { id: 'home', name: 'Home', ...HOME, radiusM: 100 },
  gym: { id: 'gym', name: 'Gym', ...GYM, radiusM: 100 },
  bar: { id: 'bar', name: 'Bar', ...BAR, radiusM: 150 },
};

export const types = (r: { consequences: { consequence: { type: string } }[] }) => r.consequences.map((c) => c.consequence.type);
