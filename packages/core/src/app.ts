/**
 * Application service shared by the Cloudflare Worker and the in-browser demo backend.
 *
 * It owns the flow around the pure engine – evaluate, apply consequences, write the lock history, persist the state,
 * record history, deliver notices – so the worker and the demo behave identically. Everything with side effects goes
 * through `AppPorts` (Chaster API + D1 + ntfy in the worker, localStorage in the demo).
 */
import { disclaimerAccepted, type LockationConfig, type ZoneRole } from './config.js';
import { diffConfig } from './diff.js';
import {
  type Actor,
  applyHuntAction,
  applyMissionAction,
  applySurpriseAction,
  type SurpriseAction,
  SurpriseActionError,
  type MissionAction,
  MissionActionError,
  startRandomMissionNow,
  type CheckinPurpose,
  type CheckinRecord,
  type EvalResult,
  evaluateCheckin,
  evaluateTick,
  evaluateTracked,
  type Fix,
  type HuntAction,
  HuntActionError,
  isLiveOnly,
  type Notice,
  type PlannedConsequence,
  tickIsNoop,
  type TrackedInput,
  type TrackedResult,
} from './engine.js';
import { initialState, type LockationState } from './state.js';
import { buildLogEntry, buildSessionView, type Role, type SessionView } from './view.js';

/** An error with an HTTP-like status, mapped to the transport by the caller (worker: HTTP response, demo: ApiError). */
export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

/** One lock session as seen by the application service. */
export interface LockSession {
  sessionId: string;
  config: LockationConfig;
  state: LockationState;
  isSelfLock: boolean;
  /** The lock is running (consequences may be applied). */
  locked: boolean;
}

export interface LogEntry {
  title: string;
  description: string;
  color?: string;
  icon?: string;
}

export interface AppPorts<S extends LockSession = LockSession> {
  now(): Date;
  newId(): string;
  rng?(): number;
  /** Persist the engine state (and refresh lock-page metadata / due index). Must update `s.state`. */
  saveState(s: S, state: LockationState): Promise<void>;
  applyConsequences(s: S, list: PlannedConsequence[]): Promise<{ ok: boolean; error?: string }[]>;
  log(s: S, entry: LogEntry): Promise<void>;
  appendHistory(s: S, record: CheckinRecord): Promise<void>;
  listHistory(s: S): Promise<CheckinRecord[]>;
  redactHistory(s: S): Promise<void>;
  /** Deliver notices (filtering, dedupe, rate limits are the adapter's job). Must never throw. */
  deliver(s: S, notices: Notice[]): Promise<void>;
  notificationStatus(s: S, audience: Role): Promise<{ available: boolean; subscribed: boolean }>;
  /** A tick had nothing to do (worker: refresh the due index without writing to Chaster). */
  idle?(s: S): Promise<void>;
}

export class LockationApp<S extends LockSession = LockSession> {
  constructor(private ports: AppPorts<S>) {}

  private ctx(s: S) {
    return { now: this.ports.now(), sessionId: s.sessionId, evalId: this.ports.newId(), rng: this.ports.rng?.bind(this.ports) };
  }

  /** The audience a viewer's notifications go to (self-locks: always the wearer). */
  audience(s: S, role: Role): Role {
    return s.isSelfLock ? 'wearer' : role;
  }

  async view(s: S, role: Role, state: LockationState = s.state): Promise<SessionView> {
    const history = await this.ports.listHistory(s);
    const v = buildSessionView({ role, isSelfLock: s.isSelfLock, config: s.config, state, history, now: this.ports.now() });
    v.notifications = await this.ports.notificationStatus(s, this.audience(s, role));
    return v;
  }

  /** Apply, log, persist, record and notify the result of one evaluation. */
  async finish(s: S, result: EvalResult & { record?: CheckinRecord }, kind: 'checkin' | 'tick', opts: { history?: boolean } = {}) {
    const applied = result.consequences.length ? await this.ports.applyConsequences(s, result.consequences) : [];
    if (result.record) result.record.consequences = result.record.consequences.map((x, i) => ({ ...x, ok: applied[i]?.ok, error: applied[i]?.error }));
    const entry = buildLogEntry(kind, result.events, result.consequences, result.record);
    if (entry) await this.ports.log(s, entry).catch(() => undefined);
    await this.ports.saveState(s, result.state);
    if (result.record && opts.history !== false) await this.ports.appendHistory(s, result.record);
    await this.ports.deliver(s, result.notices);
  }

  private requireLocked(s: S) {
    if (!s.locked) throw new AppError(409, 'not_locked', 'The lock is not running.');
  }

  // ---------- wearer actions ----------

  async checkin(s: S, role: Role, fix: Fix, purpose: CheckinPurpose): Promise<{ record: CheckinRecord; view: SessionView }> {
    if (role !== 'wearer') throw new AppError(403, 'not_wearer', 'Only the wearer can check in.');
    this.requireLocked(s);
    if (isLiveOnly(s.config)) throw new AppError(403, 'manual_disabled', 'Manual check-ins are disabled for this lock – only background tracking (OwnTracks) counts.');
    const result = evaluateCheckin(s.config, s.state, fix, this.ctx(s), purpose);
    await this.finish(s, result, 'checkin');
    return { record: result.record, view: await this.view(s, role) };
  }

  async downgradePrivacy(s: S, role: Role): Promise<SessionView> {
    const state: LockationState = { ...s.state, privacyOverride: 'zone_only' };
    if (state.lastAccepted) {
      state.lastAccepted = { ...state.lastAccepted, lat: Math.round(state.lastAccepted.lat * 1000) / 1000, lng: Math.round(state.lastAccepted.lng * 1000) / 1000 };
    }
    await this.ports.saveState(s, state);
    await this.ports.redactHistory(s);
    await this.ports.log(s, { title: 'Lockation privacy', description: 'Exact coordinates are no longer shared for this lock.', icon: 'user-secret' }).catch(() => undefined);
    return this.view(s, role);
  }

  async ackRulesChanged(s: S, role: Role): Promise<SessionView> {
    if (role !== 'wearer') throw new AppError(403, 'not_wearer', 'Only the wearer can acknowledge rule changes.');
    await this.ports.saveState(s, { ...s.state, rulesChanged: undefined });
    return this.view(s, role);
  }

  async huntAction(s: S, role: Role, action: HuntAction): Promise<SessionView> {
    this.requireLocked(s);
    let result: EvalResult;
    try {
      result = applyHuntAction(s.config, s.state, action, role as Actor, this.ctx(s), s.isSelfLock);
    } catch (e) {
      if (e instanceof HuntActionError) throw new AppError(403, 'hunt_action_not_allowed', e.message);
      throw e;
    }
    await this.finish(s, result, 'tick');
    return this.view(s, role);
  }

  /** F25 – keyholder sends / cancels a surprise mission, the wearer declines one. */
  async missionAction(s: S, role: Role, action: MissionAction): Promise<SessionView> {
    this.requireLocked(s);
    let result: EvalResult;
    try {
      result = applyMissionAction(s.config, s.state, action, role as Actor, this.ctx(s), s.isSelfLock);
    } catch (e) {
      if (e instanceof MissionActionError) throw new AppError(403, 'mission_action_not_allowed', e.message);
      throw e;
    }
    await this.finish(s, result, 'tick');
    return this.view(s, role);
  }

  /** F26 – keyholder releases the wearer from a surprise zone hold. */
  async surpriseAction(s: S, role: Role, action: SurpriseAction): Promise<SessionView> {
    this.requireLocked(s);
    let result: EvalResult;
    try {
      result = applySurpriseAction(s.config, s.state, action, role as Actor, this.ctx(s), s.isSelfLock);
    } catch (e) {
      if (e instanceof SurpriseActionError) throw new AppError(403, 'surprise_action_not_allowed', e.message);
      throw e;
    }
    await this.finish(s, result, 'tick');
    return this.view(s, role);
  }

  /** Demo / testing only: start a random mission now (ignores the schedule and the active hours). */
  async randomMissionNow(s: S, role: Role): Promise<SessionView> {
    this.requireLocked(s);
    let result: EvalResult;
    try {
      result = startRandomMissionNow(s.config, s.state, this.ctx(s));
    } catch (e) {
      if (e instanceof MissionActionError) throw new AppError(409, 'mission_not_possible', e.message);
      throw e;
    }
    await this.finish(s, result, 'tick');
    return this.view(s, role);
  }

  // ---------- background tracking ----------

  /** Record a new OwnTracks pairing (credentials are created by the adapter). */
  async paired(s: S, role: Role, deviceUser: string, extra: Partial<LockationState['tracking']> = {}): Promise<SessionView> {
    if (role !== 'wearer') throw new AppError(403, 'not_wearer', 'Only the wearer can set up background tracking.');
    this.requireLocked(s);
    if (!s.config.tracking.enabled) throw new AppError(409, 'tracking_disabled', 'Background tracking is not enabled for this lock.');
    const now = this.ports.now();
    await this.ports.saveState(s, { ...s.state, tracking: { ...s.state.tracking, deviceUser, pairedAt: now.toISOString(), waypointsHash: undefined, ...extra } });
    await this.ports.log(s, { title: 'Lockation tracking', description: 'Background tracking was set up (OwnTracks).', icon: 'satellite-dish' }).catch(() => undefined);
    await this.ports.deliver(s, [{ audience: 'keyholder', kind: 'tracking', title: 'Lockation: tracking set up', message: 'The wearer set up background tracking (waiting for the first location).', priority: 'default', key: `tracking:paired:${now.toISOString()}` }]);
    return this.view(s, role);
  }

  async unpaired(s: S, role: Role): Promise<SessionView> {
    if (role !== 'wearer') throw new AppError(403, 'not_wearer', 'Only the wearer can stop background tracking.');
    const now = this.ports.now();
    await this.ports.saveState(s, { ...s.state, tracking: { ...s.state.tracking, deviceUser: undefined, pairedAt: undefined } });
    await this.ports.log(s, { title: 'Lockation tracking', description: 'Background tracking was stopped by the wearer.', icon: 'satellite-dish' }).catch(() => undefined);
    await this.ports.deliver(s, [{ audience: 'keyholder', kind: 'tracking', title: 'Lockation: tracking stopped', message: 'The wearer stopped background tracking.', priority: 'high', key: `tracking:stopped:${now.toISOString()}` }]);
    return this.view(s, role);
  }

  /**
   * Evaluate background observations (one OwnTracks request may carry several). Consequences are applied and logged per
   * observation; the state is persisted once at the end, after `beforeSave` (e.g. OwnTracks waypoint bookkeeping).
   */
  async tracked(
    s: S,
    inputs: TrackedInput[],
    opts: { ignoreSpeed?: boolean; beforeSave?: (state: LockationState) => LockationState } = {},
  ): Promise<{ state: LockationState; results: TrackedResult[] }> {
    const config = opts.ignoreSpeed ? { ...s.config, antiCheat: { ...s.config.antiCheat, maxSpeedKmh: Number.POSITIVE_INFINITY } } : s.config;
    let state = s.state;
    const notices: Notice[] = [];
    const results: TrackedResult[] = [];
    for (const input of inputs) {
      const result = evaluateTracked(config, state, input, this.ctx(s));
      state = result.state;
      if (result.consequences.length) {
        const applied = await this.ports.applyConsequences(s, result.consequences);
        result.record.consequences = result.record.consequences.map((x, i) => ({ ...x, ok: applied[i]?.ok, error: applied[i]?.error }));
      }
      if (result.consequences.length || result.notices.some((n) => n.audience === 'wearer')) {
        const entry = buildLogEntry('checkin', result.events, result.consequences, result.record);
        if (entry) await this.ports.log(s, entry).catch(() => undefined);
      }
      if (result.notable) await this.ports.appendHistory(s, result.record);
      notices.push(...result.notices);
      results.push(result);
    }
    if (opts.beforeSave) state = opts.beforeSave(state);
    await this.ports.saveState(s, state);
    await this.ports.deliver(s, notices);
    return { state, results };
  }

  /** First state of a new session (webhook `extension_session.created`). */
  async initialize(s: S, startedAt: Date): Promise<void> {
    await this.ports.saveState(s, initialState(s.config, startedAt));
  }

  // ---------- cron ----------

  /** Deadlines, warnings, escalations … Returns whether consequences were applied. */
  async tick(s: S, opts: { hadState?: boolean } = {}): Promise<boolean> {
    const result = evaluateTick(s.config, s.state, { ...this.ctx(s), evalId: `tick-${this.ports.now().toISOString()}` });
    if (tickIsNoop(result) && opts.hadState !== false && JSON.stringify(result.state) === JSON.stringify(s.state)) {
      await this.ports.idle?.(s);
      return false;
    }
    await this.finish(s, result, 'tick');
    return result.consequences.length > 0;
  }

  // ---------- configuration ----------

  /** Validation shared by worker and demo before a configuration is stored. */
  static checkSave(before: LockationConfig | undefined, after: LockationConfig, running: boolean) {
    if (!disclaimerAccepted(after)) throw new AppError(400, 'disclaimer_required', 'Please accept the Lockation disclaimer before saving.');
    if (running && before && before.privacy.coordinates === 'zone_only' && after.privacy.coordinates === 'exact') {
      throw new AppError(403, 'privacy_upgrade', 'Coordinate sharing cannot be enabled while the lock is running.');
    }
  }

  /** Mid-lock configuration change: history entry, wearer notification and "rules changed" notice. `s.config` is the new config. */
  async announceChanges(s: S, before: LockationConfig): Promise<string[]> {
    const summary = diffConfig(before, s.config);
    if (!summary.length || !s.locked) return summary;
    const now = this.ports.now();
    await this.ports.saveState(s, { ...s.state, rulesChanged: { at: now.toISOString(), summary } });
    await this.ports.log(s, { title: 'Lockation rules changed', description: summary.join('\n').slice(0, 2000), icon: 'edit' }).catch(() => undefined);
    await this.ports.deliver(s, [{ audience: 'wearer', title: 'Lockation rules changed', message: summary.slice(0, 8).join('\n'), priority: 'default', key: `rules:${now.toISOString()}` }]);
    return summary;
  }
}

/** Roles that may use a zone (re-exported for adapters that need it). */
export type { ZoneRole };
