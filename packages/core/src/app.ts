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
  desiredToyEffects,
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
import { describeConsequence } from './consequences.js';
import { TOY_TYPES, pauseToyEffects, reconcileToyEffects, resolveToyConsequence, TOY_DISCLAIMER_VERSION, toyCommand, toyComment, type ToyConsequence, ToySetupSchema, type ToyWebhookBody, type Toy } from './toys.js';

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
  /** F27 – toy control. Without it, toy consequences are skipped (and logged). */
  toys?: {
    /** The wearer's XToys Webhook ID – stored by the adapter only, never in the state. */
    getWebhookId(s: S): Promise<string | undefined>;
    setWebhookId(s: S, webhookId: string | null): Promise<void>;
    /** Send one command to the XToys webhook. Throws on failure. */
    send(s: S, webhookId: string, body: ToyWebhookBody): Promise<void>;
  };
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

  /**
   * Apply consequences: toy actions go to the wearer's toys (XToys), everything else to the lock (Chaster).
   * Returns the per-consequence results and extra log lines (toy actions, skipped ones, a cheeky comment).
   */
  private async apply(s: S, state: LockationState, list: PlannedConsequence[]): Promise<{ applied: { ok: boolean; error?: string }[]; lines: string[]; paused: { toyIds: string[]; until: Date }[] }> {
    const applied: { ok: boolean; error?: string }[] = new Array(list.length);
    const lines: string[] = [];
    const lock = list.map((p, i) => [p, i] as const).filter(([p]) => p.consequence.type !== 'toy');
    const toy = list.map((p, i) => [p, i] as const).filter(([p]) => p.consequence.type === 'toy');
    if (lock.length) {
      const r = await this.ports.applyConsequences(s, lock.map(([p]) => p));
      lock.forEach(([, i], j) => (applied[i] = r[j] ?? { ok: false }));
    }
    const paused: { toyIds: string[]; until: Date }[] = [];
    if (!toy.length) return { applied, lines, paused };
    const enabled = s.config.rules.toy.enabled;
    const webhookId = enabled && state.toy.connectedAt && state.toy.toys.length ? await this.ports.toys?.getWebhookId(s) : undefined;
    let sent = false;
    for (const [p, i] of toy) {
      const c = p.consequence as ToyConsequence;
      const what = describeConsequence(c);
      const skip = (why: string) => {
        applied[i] = { ok: false, error: `skipped – ${why}` };
        lines.push(`🎮 Skipped (${why}): ${what}.`);
      };
      if (!enabled) {
        skip('toy control is off');
        continue;
      }
      if (!webhookId || !this.ports.toys) {
        skip('no toys connected');
        continue;
      }
      const targets = resolveToyConsequence(state.toy.toys, c);
      if (!targets.length) {
        skip('no matching toy connected');
        continue;
      }
      const errors: string[] = [];
      for (const t of targets) {
        try {
          await this.ports.toys.send(s, webhookId, t.body);
        } catch (e) {
          errors.push(`${t.toy.name}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      applied[i] = errors.length ? { ok: false, error: errors.join('; ') } : { ok: true };
      if (c.action === 'play' || c.action === 'shock') paused.push({ toyIds: targets.map((x) => x.toy.id), until: new Date(this.ports.now().getTime() + Number(targets[0]!.body.seconds ?? 1) * 1000) });
      if (errors.length < targets.length) sent = true;
      lines.push(`${what} → ${targets.map((t) => t.toy.name).join(', ')}${errors.length ? ` (failed: ${errors.join('; ')})` : ''}.`);
    }
    if (sent) lines.push(`😈 ${toyComment(toy[0]![0].idempotencyKey)}`);
    return { applied, lines, paused };
  }

  /** Apply, log, persist, record and notify the result of one evaluation. */
  async finish(s: S, result: EvalResult & { record?: CheckinRecord }, kind: 'checkin' | 'tick', opts: { history?: boolean } = {}) {
    const { applied, lines, paused } = result.consequences.length ? await this.apply(s, result.state, result.consequences) : { applied: [], lines: [], paused: [] };
    if (result.record) result.record.consequences = result.record.consequences.map((x, i) => ({ ...x, ok: applied[i]?.ok, error: applied[i]?.error }));
    const entry = buildLogEntry(kind, [...result.events, ...lines], result.consequences, result.record);
    if (entry) await this.ports.log(s, entry).catch(() => undefined);
    await this.ports.saveState(s, await this.syncToyEffects(s, withPaused(result.state, paused)));
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

  // ---------- F27 toys ----------

  /**
   * Start / renew / stop the effects that run while a condition holds ("while inside"). Starts and stops are logged,
   * renewals are not. Without connected toys nothing runs.
   */
  private async syncToyEffects(s: S, state: LockationState): Promise<LockationState> {
    const T = state.toy;
    const ports = this.ports.toys;
    const connected = s.config.rules.toy.enabled && !!T.connectedAt && T.toys.length > 0 && !!ports;
    if (!connected && !Object.keys(T.running).length) return state;
    const webhookId = connected ? await ports!.getWebhookId(s) : undefined;
    if (!webhookId) return Object.keys(T.running).length ? { ...state, toy: { ...T, running: {} } } : state;
    const now = this.ports.now();
    const desired = s.config.rules.toy.enabled ? desiredToyEffects(s.config, state) : [];
    const r = reconcileToyEffects(T.toys, desired, T.running, now);
    if (!r.commands.length && JSON.stringify(r.running) === JSON.stringify(T.running)) return state;
    const lines: string[] = [];
    for (const c of r.commands) {
      const key = `${c.toy.id}:${c.body.ch === 'all' || !c.body.ch ? 'all' : (TOY_CHANNELS[c.toy.type] ?? [])[Number(c.body.ch) - 1] ?? 'all'}`;
      const before = T.running[key];
      const after = r.running[key];
      let ok = true;
      await ports!.send(s, webhookId, c.body).catch(() => (ok = false));
      if (c.body.cmd === 'stop') lines.push(`🎮 ${c.toy.name}: stopped (${before?.label ?? 'effect ended'}).`);
      else if (!before || before.source !== after?.source || before.level !== after?.level || before.shape !== after?.shape) {
        lines.push(`🎮 ${c.toy.name}: ${after?.shape} ${after?.level} % ${after?.label ?? ''}${ok ? '' : ' (XToys did not accept it)'}.`);
      }
    }
    if (lines.length) await this.ports.log(s, { title: 'Lockation toys', description: lines.join('\n').slice(0, 2000), icon: 'gamepad' }).catch(() => undefined);
    return { ...state, toy: { ...T, running: r.running } };
  }

  private requireToys(s: S, role: Role) {
    if (role !== 'wearer') throw new AppError(403, 'not_wearer', 'Only the wearer can connect their toys.');
    this.requireLocked(s);
    if (!s.config.rules.toy.enabled) throw new AppError(409, 'toys_disabled', 'Toy control is not enabled for this lock.');
    if (!this.ports.toys) throw new AppError(503, 'toys_unavailable', 'Toy control is not available on this server.');
    return this.ports.toys;
  }

  private async requireConnected(s: S, role: Role) {
    const ports = this.requireToys(s, role);
    const webhookId = s.state.toy.connectedAt ? await ports.getWebhookId(s) : undefined;
    if (!webhookId) throw new AppError(409, 'toys_not_connected', 'No toys are connected.');
    return { ports, webhookId };
  }

  /** Wearer connects their toys: accepted toy disclaimer, Webhook ID (kept by the adapter) and the toy list. */
  async toyConnect(s: S, role: Role, input: { webhookId: string; toys: unknown; disclaimerVersion: number }): Promise<SessionView> {
    const ports = this.requireToys(s, role);
    if (input.disclaimerVersion !== TOY_DISCLAIMER_VERSION) throw new AppError(400, 'toy_disclaimer', 'Please accept the current toy safety notes first.');
    const webhookId = String(input.webhookId ?? '').trim();
    if (!/^[A-Za-z0-9_-]{4,64}$/.test(webhookId)) throw new AppError(400, 'invalid_webhook', 'That does not look like an XToys Webhook ID.');
    const setup = ToySetupSchema.safeParse({ version: 1, toys: input.toys });
    if (!setup.success || !setup.data.toys.length) {
      throw new AppError(400, 'invalid_toys', setup.success ? 'Add at least one toy.' : `Toy list: ${setup.error.issues[0]?.message ?? 'invalid'}`);
    }
    const now = this.ports.now();
    await ports.setWebhookId(s, webhookId);
    const toys = setup.data.toys;
    const connected: LockationState = { ...s.state, toy: { ...s.state.toy, connectedAt: now.toISOString(), verifiedAt: undefined, disclaimerVersion: input.disclaimerVersion, toys, running: {} } };
    s.state = connected;
    await this.ports.saveState(s, await this.syncToyEffects(s, connected));
    await this.ports.log(s, { title: 'Lockation toys', description: `🎮 Toys connected: ${toyList(toys)}.`, icon: 'gamepad' }).catch(() => undefined);
    await this.ports.deliver(s, [{ audience: 'keyholder', kind: 'toys', title: 'Lockation: toys connected', message: `The wearer connected: ${toyList(toys)}.`, priority: 'default', key: `toys:connected:${now.toISOString()}` }]);
    return this.view(s, role);
  }

  /** Setup check: a short pulse on every connected toy. */
  async toyTest(s: S, role: Role): Promise<SessionView> {
    const { ports, webhookId } = await this.requireConnected(s, role);
    const setup = { version: 1 as const, toys: s.state.toy.toys };
    const errors: string[] = [];
    for (const t of setup.toys) {
      try {
        await ports.send(s, webhookId, toyCommand(setup, t.id, { cmd: 'play', shape: 'pulse', intensity: Math.min(30, ...t.maxIntensity), seconds: 2 }));
      } catch (e) {
        errors.push(`${t.name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    if (errors.length) throw new AppError(502, 'toy_send_failed', `XToys did not accept the test: ${errors.join('; ')}`);
    return this.view(s, role);
  }

  /** The wearer confirms that the toys reacted to the test. */
  async toyConfirm(s: S, role: Role): Promise<SessionView> {
    await this.requireConnected(s, role);
    const now = this.ports.now();
    await this.ports.saveState(s, { ...s.state, toy: { ...s.state.toy, verifiedAt: now.toISOString() } });
    await this.ports.log(s, { title: 'Lockation toys', description: '🎮 The wearer confirmed that the toys react.', icon: 'gamepad' }).catch(() => undefined);
    await this.ports.deliver(s, [{ audience: 'keyholder', kind: 'toys', title: 'Lockation: toys confirmed', message: 'The wearer confirmed that the toys react.', priority: 'default', key: `toys:verified:${now.toISOString()}` }]);
    return this.view(s, role);
  }

  /** Emergency stop: always possible – stop all toys, forget the Webhook ID, apply the keyholder's punishment. */
  async toyEmergencyStop(s: S, role: Role): Promise<SessionView> {
    if (role !== 'wearer') throw new AppError(403, 'not_wearer', 'Only the wearer can use the emergency stop.');
    const ports = this.ports.toys;
    const webhookId = ports ? await ports.getWebhookId(s) : undefined;
    if (!webhookId && !s.state.toy.connectedAt) throw new AppError(409, 'toys_not_connected', 'No toys are connected.');
    if (ports && webhookId) {
      await ports.send(s, webhookId, { action: 'lockation', cmd: 'stopAll' }).catch(() => undefined);
      await ports.setWebhookId(s, null);
    }
    const now = this.ports.now();
    const punishment = s.config.rules.toy.onEmergencyStop.filter((c) => c.type !== 'toy');
    const consequences: PlannedConsequence[] = punishment.map((c, i) => ({ consequence: c, source: 'toy.onEmergencyStop', idempotencyKey: `${s.sessionId}:toy-estop:${now.toISOString()}:${i}` }));
    const state: LockationState = { ...s.state, toy: { ...s.state.toy, connectedAt: undefined, verifiedAt: undefined, toys: [], running: {}, emergencyStops: s.state.toy.emergencyStops + 1 } };
    const what = punishment.length ? punishment.map(describeConsequence).join(', ') : 'nothing';
    await this.finish(
      s,
      {
        state,
        consequences,
        events: ['🛑 Emergency stop: the wearer stopped and disconnected the toys.'],
        notices: [{ audience: 'keyholder', kind: 'toys', title: 'Lockation: toy emergency stop', message: `The wearer used the emergency stop and disconnected the toys. ${punishment.length ? `Consequences: ${what}.` : 'No consequences are set.'}`, priority: 'high', key: `toys:estop:${now.toISOString()}` }],
      },
      'tick',
    );
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
      let lines: string[] = [];
      if (result.consequences.length) {
        const r = await this.apply(s, state, result.consequences);
        lines = r.lines;
        state = withPaused(state, r.paused);
        result.record.consequences = result.record.consequences.map((x, i) => ({ ...x, ok: r.applied[i]?.ok, error: r.applied[i]?.error }));
      }
      if (result.consequences.length || result.notices.some((n) => n.audience === 'wearer')) {
        const entry = buildLogEntry('checkin', [...result.events, ...lines], result.consequences, result.record);
        if (entry) await this.ports.log(s, entry).catch(() => undefined);
      }
      if (result.notable) await this.ports.appendHistory(s, result.record);
      notices.push(...result.notices);
      results.push(result);
    }
    state = await this.syncToyEffects(s, state);
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
    const synced = await this.syncToyEffects(s, result.state);
    if (tickIsNoop(result) && opts.hadState !== false && JSON.stringify(synced) === JSON.stringify(s.state)) {
      await this.ports.idle?.(s);
      return false;
    }
    await this.finish(s, { ...result, state: synced }, 'tick');
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

const toyList = (toys: Toy[]) => toys.map((t) => `${t.name} (${t.bodyPart})`).join(', ');

/** Channel names per toy type (index 0 = XToys channel "1"). */
const TOY_CHANNELS: Record<string, readonly string[]> = Object.fromEntries(Object.entries(TOY_TYPES).map(([k, v]) => [k, v.channels]));

function withPaused(state: LockationState, paused: { toyIds: string[]; until: Date }[]): LockationState {
  if (!paused.length || !Object.keys(state.toy.running).length) return state;
  let running = state.toy.running;
  for (const p of paused) running = pauseToyEffects(running, p.toyIds, p.until);
  return { ...state, toy: { ...state.toy, running } };
}
