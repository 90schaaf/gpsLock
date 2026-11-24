/** F13 – demo backend: runs the real rule engine in the browser, persisted in localStorage. */
import {
  applyHuntAction,
  type HuntAction,
  HuntActionError,
  buildLogEntry,
  buildSessionView,
  diffConfig,
  evaluateCheckin,
  isLiveOnly,
  disclaimerAccepted,
  evaluateTick,
  evaluateTracked,
  owntracksConfigLink,
  owntracksMonitoring,
  initialState,
  KNOWN_COMMANDS,
  loadState,
  parseConfig,
  parseConfigOrDefault,
  type CheckinPurpose,
  type CheckinRecord,
  type Fix,
  type LockationConfig,
  type LockationState,
  type Notice,
} from '@lockation/core';
import { ApiError, type Backend, type NotificationSetup, type PairingResult } from './backend.js';

type Role = 'wearer' | 'keyholder';

export interface DemoStore {
  config: unknown;
  state?: LockationState;
  history: CheckinRecord[];
  log: { at: string; title: string; description: string }[];
  role: Role;
  /** Fake ntfy topics per role. */
  notify?: Partial<Record<Role, string>>;
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
    version: 2,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    zones: [
      {
        id: 'home',
        name: 'Home',
        ...off(0, 0),
        radiusM: 150,
        roles: ['required'],
        required: { stayWindows: [{ start: '23:00', end: '06:00' }] },
      },
      { id: 'gym', name: 'Gym', ...off(0.006, 0.008), radiusM: 120, roles: ['reward'], reward: { dwellMinutes: 0 } },
      {
        id: 'bar',
        name: 'Bar',
        ...off(-0.007, -0.006),
        radiusM: 120,
        roles: ['forbidden'],
        matchMode: 'strict',
        forbidden: { windows: [{ start: '20:00', end: '02:00' }], onEnter: [{ type: 'pillory', durationMinutes: 30, reason: 'Visited the bar' }] },
      },
      { id: 'casino', name: 'Casino', ...off(-0.004, 0.009), radiusM: 100, roles: ['forbidden'], matchMode: 'strict' },
    ],
    rules: {
      required: {
        enabled: true,
        intervalMinutes: 240,
        graceMinutes: 15,
        onMissed: [{ type: 'add_time', seconds: 3600 }],
        onSuccess: [],
        onOutsideDuringWindow: [{ type: 'add_time', seconds: 3600 }],
        windowCooldownMinutes: 60,
      },
      forbidden: {
        enabled: true,
        onEnter: [{ type: 'add_time', seconds: 3600 }, { type: 'freeze', durationMinutes: 60, when: { nth: 3 } }],
      },
      reward: { enabled: true, maxPerDay: 1, onEnter: [{ type: 'remove_time', seconds: 1800 }] },
      travel: { enabled: true, stepKm: 1, onStep: [{ type: 'remove_time', seconds: 300 }] },
      hunt: {
        enabled: true,
        reveal: 'all',
        order: 'sequence',
        checkpoints: [
          { id: 'cp1', name: 'North', ...off(0.004, 0), radiusM: 80, hint: 'Walk north about 450 m.' },
          { id: 'cp2', name: 'East', ...off(0.004, 0.006), radiusM: 80, hint: 'Now head east, roughly 450 m.' },
        ],
        onCheckpoint: [{ type: 'remove_time', seconds: 600 }],
        onWrong: [{ type: 'add_time', seconds: 900 }],
        onComplete: [{ type: 'remove_time', seconds: 3600 }],
      },
    },
    tracking: { enabled: true, heartbeatMinutes: 180, warnBeforeMinutes: 30, onHeartbeatMissed: [{ type: 'add_time', seconds: 1800 }] },
    antiCheat: { minIntervalSeconds: 5, maxSpeedKmh: 400, maxFixAgeSeconds: 600 },
    privacy: { coordinates: 'exact' },
    notifications: { keyholder: { penalty: true, forbiddenEntered: true, reward: true } },
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

  setRole(role: Role) {
    this.save({ ...this.load(), role });
  }

  private log(s: DemoStore, title: string, description: string) {
    s.log.unshift({ at: this.now().toISOString(), title, description });
    s.log = s.log.slice(0, 200);
  }

  /** Wearer notices (warnings) always go to the demo log; keyholder notices only if their switch is on. */
  private logNotices(s: DemoStore, config: LockationConfig, notices: Notice[]) {
    for (const n of notices) {
      if (n.audience === 'wearer') this.log(s, `🔔 ${n.title}`, n.message);
      else if (!n.kind || config.notifications.keyholder[n.kind]) this.log(s, `🔔 Keyholder: ${n.title}`, n.message);
    }
  }

  private ctx() {
    const s = this.load();
    const config = parseConfigOrDefault(s.config);
    let state = s.state ? loadState(s.state, config, this.now(), this.now()) : initialState(config, this.now());
    // Simulate the cron on every request.
    const tick = evaluateTick(config, state, { now: this.now(), sessionId: 'demo', evalId: `tick-${this.now().getTime()}` });
    state = tick.state;
    const entry = buildLogEntry('tick', tick.events, tick.consequences);
    if (entry) this.log(s, entry.title, entry.description);
    this.logNotices(s, config, tick.notices);
    s.state = state;
    this.save(s);
    return { s, config, state };
  }

  private view(s: DemoStore, config: LockationConfig, state: LockationState) {
    const v = buildSessionView({ role: s.role, isSelfLock: false, config, state, history: s.history, now: this.now() });
    v.notifications = { available: true, subscribed: !!s.notify?.[s.role] };
    return v;
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
    if (entry) this.log(s, entry.title, entry.description);
    this.logNotices(s, config, res.notices);
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
    return { config: parseConfigOrDefault(s.config), role: 'keyholder' as const, sessionId: s.state ? 'demo' : null };
  }

  async configSave(config: LockationConfig) {
    const parsed = parseConfig(config);
    if (!parsed.ok) throw new ApiError(400, 'invalid_config', 'The configuration is invalid.', parsed.issues);
    if (!disclaimerAccepted(parsed.config)) throw new ApiError(400, 'disclaimer_required', 'Please accept the Lockation disclaimer before saving.');
    const s = this.load();
    if (s.state) {
      // The demo "lock" keeps running – like the worker, tell the wearer what changed.
      const summary = diffConfig(parseConfigOrDefault(s.config), parsed.config);
      if (summary.length) {
        const state = loadState(s.state, parsed.config, this.now(), this.now());
        state.rulesChanged = { at: this.now().toISOString(), summary };
        s.state = state;
        this.log(s, 'Lockation rules changed', summary.join('\n'));
        if (s.notify?.wearer) this.log(s, '🔔 Lockation rules changed', summary.join('\n'));
      }
    }
    this.save({ ...s, config: parsed.config });
  }

  async capabilities() {
    return { commands: KNOWN_COMMANDS.map((c) => ({ ...c, available: true })), live: false };
  }

  async pairTracking(): Promise<PairingResult> {
    const { s, config, state } = this.ctx();
    if (s.role !== 'wearer') throw new ApiError(403, 'not_wearer', 'Only the wearer can set up background tracking.');
    const opts = { url: 'https://lockation.example.workers.dev/track/owntracks', username: 'lodemo', password: 'demo-password', monitoring: owntracksMonitoring(config) };
    s.state = { ...state, tracking: { ...state.tracking, deviceUser: opts.username, pairedAt: this.now().toISOString() } };
    this.save(s);
    return { link: owntracksConfigLink(opts), url: opts.url, username: opts.username, password: opts.password, view: this.view(s, config, s.state) };
  }

  async unpairTracking() {
    const { s, config, state } = this.ctx();
    s.state = { ...state, tracking: { ...state.tracking, deviceUser: undefined, pairedAt: undefined } };
    this.save(s);
    return this.view(s, config, s.state);
  }

  async setupNotifications(): Promise<NotificationSetup> {
    const { s, config, state } = this.ctx();
    const topic = `lockation-demo-${s.role}-${Math.random().toString(36).slice(2, 10)}`;
    s.notify = { ...s.notify, [s.role]: topic };
    this.save(s);
    return { topic, url: `https://ntfy.sh/${topic}`, deepLink: `ntfy://ntfy.sh/${topic}`, view: this.view(s, config, state) };
  }

  async stopNotifications() {
    const { s, config, state } = this.ctx();
    if (s.notify) delete s.notify[s.role];
    this.save(s);
    return this.view(s, config, state);
  }

  async ackRulesChanged() {
    const { s, config, state } = this.ctx();
    if (s.role !== 'wearer') throw new ApiError(403, 'not_wearer', 'Only the wearer can acknowledge rule changes.');
    s.state = { ...state, rulesChanged: undefined };
    this.save(s);
    return this.view(s, config, s.state);
  }

  async testNotification(): Promise<{ ok: true }> {
    const { s } = this.ctx();
    if (!s.notify?.[s.role]) throw new ApiError(409, 'not_subscribed', 'Set up notifications first.');
    this.log(s, '🔔 ✅ Lockation test notification', 'Notifications work (demo – nothing is sent).');
    this.save(s);
    return { ok: true };
  }

  async huntAction(action: HuntAction) {
    const { s, config, state } = this.ctx();
    let res;
    try {
      res = applyHuntAction(config, state, action, s.role, { now: this.now(), sessionId: 'demo', evalId: crypto.randomUUID() }, false);
    } catch (e) {
      if (e instanceof HuntActionError) throw new ApiError(403, 'hunt_action_not_allowed', e.message);
      throw e;
    }
    for (const ev of res.events) this.log(s, 'Lockation', ev);
    for (const n of res.notices.filter((x) => x.audience === 'wearer')) this.log(s, `🔔 ${n.title}`, n.message);
    s.state = res.state;
    this.save(s);
    return this.view(s, config, s.state);
  }

  /** Demo only: pretend OwnTracks sent this position (like tapping ↑ in the app, which also completes the setup). */
  async track(fix: Fix) {
    const { s, config, state } = this.ctx();
    const res = evaluateTracked(config, state, { fix, manual: true }, { now: this.now(), sessionId: 'demo', evalId: crypto.randomUUID() });
    res.record.consequences = res.record.consequences.map((c) => ({ ...c, ok: true }));
    if (res.consequences.length || res.events.length) {
      const entry = buildLogEntry('checkin', res.events, res.consequences, res.record);
      if (entry) this.log(s, entry.title.replace('GPS check-in', 'GPS background update'), entry.description);
    }
    this.logNotices(s, config, res.notices);
    s.state = res.state;
    if (res.notable) s.history = [res.record, ...s.history].slice(0, 200);
    this.save(s);
    return { record: res.record, view: this.view(s, config, res.state) };
  }

  demoLog() {
    return this.load().log;
  }
}
