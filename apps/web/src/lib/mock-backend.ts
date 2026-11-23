/** F13 – demo backend: runs the real rule engine in the browser, persisted in localStorage. */
import {
  buildLogEntry,
  buildSessionView,
  evaluateCheckin,
  isLiveOnly,
  disclaimerAccepted,
  evaluateTick,
  evaluateTracked,
  owntracksConfigLink,
  initialState,
  KNOWN_COMMANDS,
  parseConfig,
  parseConfigOrDefault,
  type CheckinPurpose,
  type CheckinRecord,
  type Fix,
  type LockationConfig,
  type LockationState,
} from '@lockation/core';
import { ApiError, type Backend, type PairingResult } from './backend.js';

export interface DemoStore {
  config: unknown;
  state?: LockationState;
  history: CheckinRecord[];
  log: { at: string; title: string; description: string }[];
  role: 'wearer' | 'keyholder';
}

const KEY = 'lockation-demo-v1';

export interface StorageLike {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

export function demoConfig(center = { lat: 47.3769, lng: 8.5417 }): LockationConfig {
  const off = (dLat: number, dLng: number) => ({ lat: center.lat + dLat, lng: center.lng + dLng });
  return parseConfigOrDefault({
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    zones: [
      { id: 'home', name: 'Home', ...off(0, 0), radiusM: 150 },
      { id: 'gym', name: 'Gym', ...off(0.006, 0.008), radiusM: 120 },
      { id: 'bar', name: 'Bar', ...off(-0.007, -0.006), radiusM: 120 },
    ],
    rules: {
      required: { enabled: true, zoneIds: ['home'], intervalMinutes: 240, graceMinutes: 15, onMissed: [{ type: 'add_time', seconds: 3600 }], onSuccess: [] },
      forbidden: { enabled: true, zoneIds: ['bar'], onEnter: [{ type: 'add_time', seconds: 7200 }, { type: 'pillory', durationMinutes: 30, reason: 'Visited a forbidden place' }] },
      reward: { enabled: true, zoneIds: ['gym'], maxPerDay: 1, onEnter: [{ type: 'remove_time', seconds: 1800 }] },
      travel: { enabled: true, stepKm: 1, onStep: [{ type: 'remove_time', seconds: 300 }] },
      curfew: { enabled: true, zoneIds: ['home'], start: '23:00', end: '06:00', onOutside: [{ type: 'add_time', seconds: 3600 }] },
      hunt: {
        enabled: true,
        reveal: 'distance',
        checkpoints: [
          { id: 'cp1', name: 'North', ...off(0.004, 0), radiusM: 80, hint: 'Walk north about 450 m.' },
          { id: 'cp2', name: 'East', ...off(0.004, 0.006), radiusM: 80, hint: 'Now head east, roughly 450 m.' },
        ],
        onCheckpoint: [{ type: 'remove_time', seconds: 600 }],
        onWrong: [{ type: 'add_time', seconds: 900 }],
        onComplete: [{ type: 'remove_time', seconds: 3600 }],
      },
    },
    tracking: { enabled: true, heartbeatMinutes: 180, entryConfirmMinutes: 0, onHeartbeatMissed: [{ type: 'add_time', seconds: 1800 }] },
    antiCheat: { minIntervalSeconds: 5, maxSpeedKmh: 400, maxFixAgeSeconds: 600 },
    privacy: { coordinates: 'exact' },
  });
}

export class MockBackend implements Backend {
  readonly demo = true;
  constructor(
    private storage: StorageLike = window.localStorage,
    private now: () => Date = () => new Date(),
  ) {}

  load(): DemoStore {
    try {
      const raw = this.storage.getItem(KEY);
      if (raw) return JSON.parse(raw) as DemoStore;
    } catch {
      /* ignore */
    }
    return { config: demoConfig(), history: [], log: [], role: 'wearer' };
  }

  save(s: DemoStore) {
    this.storage.setItem(KEY, JSON.stringify(s));
  }

  reset(center?: { lat: number; lng: number }) {
    this.save({ config: demoConfig(center), history: [], log: [], role: this.load().role });
  }

  setRole(role: 'wearer' | 'keyholder') {
    this.save({ ...this.load(), role });
  }

  private ctx() {
    const s = this.load();
    const config = parseConfigOrDefault(s.config);
    let state = s.state ?? initialState(config, this.now());
    // Simulate the cron on every request.
    const tick = evaluateTick(config, state, { now: this.now(), sessionId: 'demo', evalId: `tick-${this.now().getTime()}` });
    state = tick.state;
    const entry = buildLogEntry('tick', tick.events, tick.consequences);
    if (entry) s.log.unshift({ at: this.now().toISOString(), title: entry.title, description: entry.description });
    s.state = state;
    this.save(s);
    return { s, config, state };
  }

  private view(s: DemoStore, config: LockationConfig, state: LockationState) {
    return buildSessionView({ role: s.role, isSelfLock: false, config, state, history: s.history, now: this.now() });
  }

  async session() {
    const { s, config, state } = this.ctx();
    return this.view(s, config, state);
  }

  async checkin(fix: Fix, purpose: CheckinPurpose) {
    const { s, config, state } = this.ctx();
    if (s.role !== 'wearer') throw new ApiError(403, 'not_wearer', 'Only the wearer can check in (switch role in the demo bar).');
    if (isLiveOnly(config)) throw new ApiError(403, 'manual_disabled', 'Manual check-ins are disabled for this lock – only live tracking counts.');
    const res = evaluateCheckin(config, state, fix, { now: this.now(), sessionId: 'demo', evalId: crypto.randomUUID() }, purpose);
    res.record.consequences = res.record.consequences.map((c) => ({ ...c, ok: true }));
    const entry = buildLogEntry('checkin', res.events, res.consequences, res.record);
    if (entry) s.log.unshift({ at: this.now().toISOString(), title: entry.title, description: entry.description });
    s.state = res.state;
    s.history = [res.record, ...s.history].slice(0, 200);
    this.save(s);
    return { record: res.record, view: this.view(s, config, res.state) };
  }

  async downgradePrivacy() {
    const { s, config, state } = this.ctx();
    s.state = { ...state, privacyOverride: 'zone_only' };
    s.history = s.history.map(({ lat: _a, lng: _b, ...r }) => r);
    this.save(s);
    return this.view(s, config, s.state);
  }

  async configGet() {
    const s = this.load();
    return { config: parseConfigOrDefault(s.config), role: 'keyholder' as const, sessionId: null };
  }

  async configSave(config: LockationConfig) {
    const parsed = parseConfig(config);
    if (!parsed.ok) throw new ApiError(400, 'invalid_config', 'The configuration is invalid.', parsed.issues);
    if (!disclaimerAccepted(parsed.config)) throw new ApiError(400, 'disclaimer_required', 'Please accept the Lockation disclaimer before saving.');
    const s = this.load();
    // Restart the demo session with the new configuration.
    this.save({ ...s, config: parsed.config, state: undefined, history: [], log: [] });
  }

  async capabilities() {
    return { commands: KNOWN_COMMANDS.map((c) => ({ ...c, available: true })), live: false };
  }

  async pairTracking(): Promise<PairingResult> {
    const { s, config, state } = this.ctx();
    if (s.role !== 'wearer') throw new ApiError(403, 'not_wearer', 'Only the wearer can set up background tracking.');
    const opts = { url: 'https://lockation.example.workers.dev/track/owntracks', username: 'lodemo', password: 'demo-password' };
    s.state = { ...state, tracking: { ...state.tracking, deviceUser: opts.username, pairedAt: this.now().toISOString() } };
    this.save(s);
    return { link: owntracksConfigLink(opts), ...opts, view: this.view(s, config, s.state) };
  }

  async unpairTracking() {
    const { s, config, state } = this.ctx();
    s.state = { ...state, tracking: { ...state.tracking, deviceUser: undefined, pairedAt: undefined } };
    this.save(s);
    return this.view(s, config, s.state);
  }

  /** Demo only: pretend OwnTracks sent this position from the background. */
  async track(fix: Fix) {
    const { s, config, state } = this.ctx();
    const res = evaluateTracked(config, state, { fix }, { now: this.now(), sessionId: 'demo', evalId: crypto.randomUUID() });
    res.record.consequences = res.record.consequences.map((c) => ({ ...c, ok: true }));
    if (res.consequences.length) {
      const entry = buildLogEntry('checkin', res.events, res.consequences, res.record);
      if (entry) s.log.unshift({ at: this.now().toISOString(), title: entry.title.replace('GPS check-in', 'GPS background update'), description: entry.description });
    }
    s.state = res.state;
    if (res.notable) s.history = [res.record, ...s.history].slice(0, 200);
    this.save(s);
    return { record: res.record, view: this.view(s, config, res.state) };
  }

  demoLog() {
    return this.load().log;
  }
}
