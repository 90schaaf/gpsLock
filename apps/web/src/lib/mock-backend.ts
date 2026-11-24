/** F13 – demo backend: runs the real rule engine in the browser, persisted in localStorage. */
import {
  AppError,
  type CheckinPurpose,
  type CheckinRecord,
  type Fix,
  type HuntAction,
  initialState,
  KNOWN_COMMANDS,
  loadState,
  LockationApp,
  type LockationConfig,
  type LockationState,
  type LockSession,
  owntracksConfigLink,
  owntracksLocatorInterval,
  owntracksMonitoring,
  parseConfig,
  parseConfigOrDefault,
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

/** A demo "lock session": the shared application service works on this, the adapter keeps it in localStorage. */
interface DemoSession extends LockSession {
  store: DemoStore;
}

/**
 * Demo backend. The flow (evaluate, apply, log, persist, history, notices) is the shared `LockationApp` from
 * @lockation/core – the same code the worker runs; only the ports differ (localStorage instead of Chaster/D1/ntfy).
 */
export class MockBackend implements Backend {
  readonly demo = true;
  private app: LockationApp<DemoSession>;

  constructor(
    private storage: StorageLike = window.localStorage,
    private now: () => Date = () => new Date(),
  ) {
    const self = this;
    this.app = new LockationApp<DemoSession>({
      now: () => self.now(),
      newId: () => crypto.randomUUID(),
      async saveState(d, state) {
        d.state = state;
        d.store.state = state;
        self.save(d.store);
      },
      async applyConsequences(_d, list) {
        return list.map(() => ({ ok: true }));
      },
      async log(d, entry) {
        self.log(d.store, entry.title, entry.description);
        self.save(d.store);
      },
      async appendHistory(d, record) {
        d.store.history = [record, ...d.store.history].slice(0, 200);
        self.save(d.store);
      },
      async listHistory(d) {
        return d.store.history;
      },
      async redactHistory(d) {
        d.store.history = d.store.history.map(({ lat: _a, lng: _b, ...r }) => r);
        self.save(d.store);
      },
      async deliver(d, notices) {
        // Wearer notices (warnings) always go to the demo log; keyholder notices only if their switch is on.
        for (const n of notices) {
          if (n.audience === 'wearer') self.log(d.store, `🔔 ${n.title}`, n.message);
          else if (!n.kind || d.config.notifications.keyholder[n.kind]) self.log(d.store, `🔔 Keyholder: ${n.title}`, n.message);
        }
        self.save(d.store);
      },
      async notificationStatus(d, audience) {
        return { available: true, subscribed: !!d.store.notify?.[audience] };
      },
    });
  }

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

  /** Load the demo session and simulate the cron (every request runs a tick, like the worker's 1-minute cron). */
  private async session_(): Promise<DemoSession> {
    const store = this.load();
    const config = parseConfigOrDefault(store.config);
    const state = store.state ? loadState(store.state, config, this.now(), this.now()) : initialState(config, this.now());
    const d: DemoSession = { sessionId: 'demo', config, state, isSelfLock: false, locked: true, store };
    await this.app.tick(d, { hadState: !!store.state });
    store.state = d.state;
    this.save(store);
    return d;
  }

  /** Map the shared AppError to the transport error the UI understands. */
  private async run<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof AppError) throw new ApiError(e.status, e.code, e.message, e.details);
      throw e;
    }
  }

  async session() {
    const d = await this.session_();
    return this.app.view(d, d.store.role);
  }

  async checkin(fix: Fix, purpose: CheckinPurpose) {
    return this.run(async () => {
      const d = await this.session_();
      if (d.store.role !== 'wearer') throw new AppError(403, 'not_wearer', 'Only the wearer can check in (switch role in the demo bar).');
      return this.app.checkin(d, d.store.role, fix, purpose);
    });
  }

  async downgradePrivacy() {
    const d = await this.session_();
    return this.app.downgradePrivacy(d, d.store.role);
  }

  async configGet() {
    const s = this.load();
    return { config: parseConfigOrDefault(s.config), role: 'keyholder' as const, sessionId: s.state ? 'demo' : null };
  }

  async configSave(config: LockationConfig) {
    return this.run(async () => {
      const parsed = parseConfig(config);
      if (!parsed.ok) throw new AppError(400, 'invalid_config', 'The configuration is invalid.', parsed.issues);
      const store = this.load();
      const before = parseConfigOrDefault(store.config);
      LockationApp.checkSave(before, parsed.config, false); // the demo lock may switch privacy freely
      store.config = parsed.config;
      this.save(store);
      if (store.state) {
        // The demo "lock" keeps running – like the worker, tell the wearer what changed.
        const d: DemoSession = { sessionId: 'demo', config: parsed.config, state: loadState(store.state, parsed.config, this.now(), this.now()), isSelfLock: false, locked: true, store };
        await this.app.announceChanges(d, before);
      }
    });
  }

  async capabilities() {
    return { commands: KNOWN_COMMANDS.map((c) => ({ ...c, available: true })), live: false };
  }

  async pairTracking(): Promise<PairingResult> {
    return this.run(async () => {
      const d = await this.session_();
      const monitoring = owntracksMonitoring(d.config);
      const locatorInterval = owntracksLocatorInterval(d.config);
      const opts = { url: 'https://lockation.example.workers.dev/track/owntracks', username: 'lodemo', password: 'demo-password', monitoring, locatorInterval };
      const view = await this.app.paired(d, d.store.role, opts.username, { monitoring, locatorInterval });
      return { link: owntracksConfigLink(opts), url: opts.url, username: opts.username, password: opts.password, view };
    });
  }

  async unpairTracking() {
    return this.run(async () => {
      const d = await this.session_();
      return this.app.unpaired(d, d.store.role);
    });
  }

  async setupNotifications(): Promise<NotificationSetup> {
    const d = await this.session_();
    const audience = this.app.audience(d, d.store.role);
    const topic = `lockation-demo-${audience}-${Math.random().toString(36).slice(2, 10)}`;
    d.store.notify = { ...d.store.notify, [audience]: topic };
    this.log(d.store, '🔔 ✅ Lockation test notification', 'Notifications are set up (demo – nothing is sent).');
    this.save(d.store);
    return { topic, url: `https://ntfy.sh/${topic}`, deepLink: `ntfy://ntfy.sh/${topic}`, view: await this.app.view(d, d.store.role) };
  }

  async stopNotifications() {
    const d = await this.session_();
    if (d.store.notify) delete d.store.notify[this.app.audience(d, d.store.role)];
    this.save(d.store);
    return this.app.view(d, d.store.role);
  }

  async ackRulesChanged() {
    return this.run(async () => {
      const d = await this.session_();
      return this.app.ackRulesChanged(d, d.store.role);
    });
  }

  async testNotification(): Promise<{ ok: true }> {
    const d = await this.session_();
    if (!d.store.notify?.[this.app.audience(d, d.store.role)]) throw new ApiError(409, 'not_subscribed', 'Set up notifications first.');
    this.log(d.store, '🔔 ✅ Lockation test notification', 'Notifications work (demo – nothing is sent).');
    this.save(d.store);
    return { ok: true };
  }

  async huntAction(action: HuntAction) {
    return this.run(async () => {
      const d = await this.session_();
      return this.app.huntAction(d, d.store.role, action);
    });
  }

  /** Demo: map clicks send a fake background location (stored per browser). */
  get mapClickSends(): boolean {
    try {
      return localStorage.getItem('lockation-demo-click-sends') !== 'off';
    } catch {
      return true;
    }
  }
  set mapClickSends(on: boolean) {
    try {
      localStorage.setItem('lockation-demo-click-sends', on ? 'on' : 'off');
    } catch {
      /* private mode – keep the default */
    }
  }

  /** Demo only: pretend OwnTracks sent this position (like tapping ↑ in the app, which also completes the setup). */
  async track(fix: Fix, opts: { ignoreSpeed?: boolean } = {}) {
    const d = await this.session_();
    const { results } = await this.app.tracked(d, [{ fix, manual: true }], { ignoreSpeed: opts.ignoreSpeed });
    const record: CheckinRecord = results[0]!.record;
    return { record, view: await this.app.view(d, d.store.role) };
  }

  demoLog() {
    return this.load().log;
  }
}
