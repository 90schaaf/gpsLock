/** Application service: orchestrates Chaster API, core engine and storage. */
import {
  buildLogEntry,
  buildSessionView,
  computeMetadata,
  disclaimerAccepted,
  evaluateCheckin,
  isLiveOnly,
  evaluateTick,
  evaluateTracked,
  owntracksConfigLink,
  owntracksWaypoints,
  parseOwnTracks,
  initialState,
  KNOWN_COMMANDS,
  loadState,
  parseConfig,
  parseConfigOrDefault,
  tickIsNoop,
  type CheckinPurpose,
  type CheckinRecord,
  type EvalResult,
  type Fix,
  type LockationConfig,
  type LockationState,
  type SessionView,
} from '@lockation/core';
import { applyAll } from './apply.js';
import { sessionIdOf, type ChasterClient, type ChasterSession } from './chaster.js';
import { DeviceStore, HistoryStore } from './store.js';
import { HttpError } from './types.js';

export const STATE_KEY = 'lockation';

export interface ServiceDeps {
  client: ChasterClient;
  history: HistoryStore;
  devices?: DeviceStore;
  now?: () => Date;
  rng?: () => number;
  newId?: () => string;
}

interface Resolved {
  role: 'wearer' | 'keyholder';
  session: ChasterSession;
  sessionId: string;
  config: LockationConfig;
  state: LockationState;
  isSelfLock: boolean;
}

export class LockationService {
  private client: ChasterClient;
  private history: HistoryStore;
  private devices?: DeviceStore;
  private now: () => Date;
  private rng: () => number;
  private newId: () => string;

  constructor(deps: ServiceDeps) {
    this.client = deps.client;
    this.history = deps.history;
    this.devices = deps.devices;
    this.now = deps.now ?? (() => new Date());
    this.rng = deps.rng ?? Math.random;
    this.newId = deps.newId ?? (() => crypto.randomUUID());
  }

  // ---------- helpers ----------
  private stateFor(session: ChasterSession, config: LockationConfig): LockationState {
    const start = new Date(session.lock?.startDate ?? session.createdAt ?? this.now().toISOString());
    return loadState(session.data?.[STATE_KEY], config, start);
  }

  private async resolve(mainToken: string): Promise<Resolved> {
    if (!mainToken) throw new HttpError(401, 'missing_token', 'mainToken is required');
    const auth = await this.client.authSession(mainToken);
    const session = auth.session;
    const config = parseConfigOrDefault(session.config);
    return {
      role: auth.role,
      session,
      sessionId: sessionIdOf(session),
      config,
      state: this.stateFor(session, config),
      isSelfLock: !session.lock?.keyholder,
    };
  }

  private async persist(r: Pick<Resolved, 'session' | 'sessionId' | 'config'>, state: LockationState) {
    await this.client.setData(r.sessionId, { ...(r.session.data ?? {}), [STATE_KEY]: state });
    try {
      await this.client.setMetadata(r.sessionId, computeMetadata(r.config, state, this.now()));
    } catch {
      /* metadata is cosmetic – never fail the request because of it */
    }
  }

  private async view(r: Resolved, state: LockationState): Promise<SessionView> {
    const history = await this.history.list(r.sessionId);
    return buildSessionView({ role: r.role, isSelfLock: r.isSelfLock, config: r.config, state, history, now: this.now() });
  }

  // ---------- main page ----------
  async sessionView(mainToken: string): Promise<SessionView> {
    const r = await this.resolve(mainToken);
    return this.view(r, r.state);
  }

  async checkin(mainToken: string, fix: Fix, purpose: CheckinPurpose): Promise<{ record: CheckinRecord; view: SessionView }> {
    const r = await this.resolve(mainToken);
    if (r.role !== 'wearer') throw new HttpError(403, 'not_wearer', 'Only the wearer can check in.');
    if (r.session.lock?.status && r.session.lock.status !== 'locked') throw new HttpError(409, 'not_locked', 'The lock is not running.');
    if (isLiveOnly(r.config)) {
      throw new HttpError(403, 'manual_disabled', 'Manual check-ins are disabled for this lock – only live tracking (OwnTracks) counts.');
    }
    const now = this.now();
    const result = evaluateCheckin(r.config, r.state, fix, { now, sessionId: r.sessionId, evalId: this.newId(), rng: this.rng }, purpose);
    const applied = await applyAll(this.client, r.sessionId, result.consequences);
    result.record.consequences = result.record.consequences.map((c, i) => ({ ...c, ok: applied[i]?.ok, error: applied[i]?.error }));

    const log = buildLogEntry('checkin', result.events, result.consequences, result.record);
    if (log) await this.client.customLog(r.sessionId, log).catch(() => undefined);
    await this.persist(r, result.state);
    await this.history.append(r.sessionId, result.record);
    return { record: result.record, view: await this.view(r, result.state) };
  }

  async downgradePrivacy(mainToken: string): Promise<SessionView> {
    const r = await this.resolve(mainToken);
    const state: LockationState = { ...r.state, privacyOverride: 'zone_only' };
    if (state.lastAccepted) {
      state.lastAccepted = {
        ...state.lastAccepted,
        lat: Math.round(state.lastAccepted.lat * 1000) / 1000,
        lng: Math.round(state.lastAccepted.lng * 1000) / 1000,
      };
    }
    await this.persist(r, state);
    await this.history.redact(r.sessionId);
    await this.client
      .customLog(r.sessionId, { title: 'Lockation privacy', description: 'Exact coordinates are no longer shared for this lock.', icon: 'user-secret' })
      .catch(() => undefined);
    return this.view(r, state);
  }

  // ---------- configuration page ----------
  async configGet(configToken: string) {
    if (!configToken) throw new HttpError(401, 'missing_token', 'configToken is required');
    const c = await this.client.getConfiguration(configToken);
    const parsed = parseConfig(c.config);
    return {
      config: parsed.ok ? parsed.config : parseConfigOrDefault(undefined),
      invalidStoredConfig: parsed.ok ? undefined : parsed.issues,
      role: c.role,
      sessionId: c.sessionId,
    };
  }

  async configSave(configToken: string, input: unknown) {
    if (!configToken) throw new HttpError(401, 'missing_token', 'configToken is required');
    const parsed = parseConfig(input);
    if (!parsed.ok) throw new HttpError(400, 'invalid_config', 'The configuration is invalid.', parsed.issues);
    if (!disclaimerAccepted(parsed.config)) {
      throw new HttpError(400, 'disclaimer_required', 'Please accept the Lockation disclaimer before saving.');
    }
    const current = await this.client.getConfiguration(configToken);
    if (current.sessionId) {
      // F9 AC3: privacy cannot be upgraded while a session is running.
      const before = parseConfigOrDefault(current.config);
      if (before.privacy.coordinates === 'zone_only' && parsed.config.privacy.coordinates === 'exact') {
        throw new HttpError(403, 'privacy_upgrade', 'Coordinate sharing cannot be enabled while the lock is running.');
      }
    }
    await this.client.putConfiguration(configToken, parsed.config);
    return { ok: true as const, config: parsed.config };
  }

  async capabilities(opts: { mainToken?: string; configToken?: string }) {
    let sessionId: string | null = null;
    if (opts.mainToken) sessionId = (await this.resolve(opts.mainToken)).sessionId;
    else if (opts.configToken) sessionId = (await this.client.getConfiguration(opts.configToken)).sessionId;
    const known = KNOWN_COMMANDS.map((k) => ({ id: k.id, extension: k.extension, title: k.title, description: k.description, exampleInput: k.exampleInput, available: true, source: 'known' as const }));
    if (!sessionId) return { commands: known, live: false };
    try {
      const exts = await this.client.capabilities(sessionId);
      const live = exts.flatMap((e) =>
        e.commands
          .filter((c) => !c.invocableBy?.length || c.invocableBy.includes('extension'))
          .map((c) => ({ id: c.id, extension: e.displayName, title: c.title, description: c.description, inputSchema: c.inputSchema, available: c.available, reason: c.reason, source: 'live' as const })),
      );
      return { commands: live, live: true };
    } catch {
      return { commands: known, live: false };
    }
  }

  // ---------- cron / webhooks ----------
  /** Evaluate deadlines for one session; returns true when something was applied. */
  async tickSession(session: ChasterSession): Promise<boolean> {
    const sessionId = sessionIdOf(session);
    const config = parseConfigOrDefault(session.config);
    const hadState = !!session.data?.[STATE_KEY];
    const state = this.stateFor(session, config);
    const result: EvalResult = evaluateTick(config, state, { now: this.now(), sessionId, evalId: `tick-${this.now().toISOString()}` });
    if (tickIsNoop(result) && hadState && JSON.stringify(result.state) === JSON.stringify(state)) return false;
    await applyAll(this.client, sessionId, result.consequences);
    const log = buildLogEntry('tick', result.events, result.consequences);
    if (log) await this.client.customLog(sessionId, log).catch(() => undefined);
    await this.persist({ session, sessionId, config }, result.state);
    return result.consequences.length > 0;
  }

  async initSession(session: ChasterSession) {
    const sessionId = sessionIdOf(session);
    const config = parseConfigOrDefault(session.config);
    if (session.data?.[STATE_KEY]) return;
    const start = new Date(session.lock?.startDate ?? session.createdAt ?? this.now().toISOString());
    await this.persist({ session, sessionId, config }, initialState(config, start));
  }

  async onSessionDeleted(sessionId: string) {
    await this.history.purge(sessionId);
    await this.devices?.removeForSession(sessionId);
  }

  // ---------- F14 background tracking ----------
  private requireDevices(): DeviceStore {
    if (!this.devices) throw new HttpError(500, 'not_configured', 'Device store missing.');
    return this.devices;
  }

  async pairTracking(mainToken: string, endpointUrl: string) {
    const r = await this.resolve(mainToken);
    if (r.role !== 'wearer') throw new HttpError(403, 'not_wearer', 'Only the wearer can set up background tracking.');
    if (r.session.lock?.status && r.session.lock.status !== 'locked') throw new HttpError(409, 'not_locked', 'The lock is not running.');
    if (!r.config.tracking.enabled) throw new HttpError(409, 'tracking_disabled', 'Background tracking is not enabled for this lock.');
    const now = this.now();
    const creds = await this.requireDevices().create(r.sessionId, now);
    const state: LockationState = {
      ...r.state,
      tracking: { ...r.state.tracking, deviceUser: creds.username, pairedAt: now.toISOString(), waypointsHash: undefined },
    };
    await this.persist(r, state);
    await this.client
      .customLog(r.sessionId, { title: 'Lockation tracking', description: 'Background tracking was set up (OwnTracks).', icon: 'satellite-dish' })
      .catch(() => undefined);
    const opts = { url: endpointUrl, username: creds.username, password: creds.password };
    return { link: owntracksConfigLink(opts), ...opts, view: await this.view(r, state) };
  }

  async unpairTracking(mainToken: string): Promise<SessionView> {
    const r = await this.resolve(mainToken);
    if (r.role !== 'wearer') throw new HttpError(403, 'not_wearer', 'Only the wearer can stop background tracking.');
    await this.requireDevices().removeForSession(r.sessionId);
    const state: LockationState = { ...r.state, tracking: { ...r.state.tracking, deviceUser: undefined, pairedAt: undefined } };
    await this.persist(r, state);
    await this.client
      .customLog(r.sessionId, { title: 'Lockation tracking', description: 'Background tracking was stopped by the wearer.', icon: 'satellite-dish' })
      .catch(() => undefined);
    return this.view(r, state);
  }

  /** Handle one OwnTracks HTTP POST. Returns the JSON array to send back to the app. */
  async ingestOwnTracks(username: string, password: string, body: unknown): Promise<unknown[]> {
    const devices = this.requireDevices();
    const dev = await devices.verify(username, password);
    if (!dev) throw new HttpError(401, 'unauthorized', 'Unknown device.');
    let session: ChasterSession;
    try {
      session = await this.client.getSession(dev.sessionId);
    } catch (e) {
      if (e instanceof HttpError && e.status === 404) {
        await devices.removeForSession(dev.sessionId);
        throw new HttpError(401, 'unauthorized', 'Session ended.');
      }
      throw e;
    }
    if (session.lock?.status && session.lock.status !== 'locked') return [];
    const sessionId = sessionIdOf(session);
    const config = parseConfigOrDefault(session.config);
    let state = this.stateFor(session, config);
    if (state.tracking.deviceUser !== username) {
      await devices.removeForSession(sessionId);
      throw new HttpError(401, 'unauthorized', 'Device was revoked.');
    }
    if (!config.tracking.enabled) return [];

    const messages = Array.isArray(body) ? body : [body];
    const response: unknown[] = [];
    for (const m of messages) {
      const input = parseOwnTracks(m, config);
      if (!input) continue;
      const result = evaluateTracked(config, state, input, { now: this.now(), sessionId, evalId: this.newId(), rng: this.rng });
      state = result.state;
      if (result.consequences.length) {
        const applied = await applyAll(this.client, sessionId, result.consequences);
        result.record.consequences = result.record.consequences.map((c, i) => ({ ...c, ok: applied[i]?.ok, error: applied[i]?.error }));
        const log = buildLogEntry('checkin', result.events, result.consequences, result.record);
        if (log) {
          await this.client.customLog(sessionId, { ...log, title: log.title.replace('GPS check-in', 'GPS background update') }).catch(() => undefined);
        }
      }
      if (result.notable) await this.history.append(sessionId, result.record);
    }
    const wp = owntracksWaypoints(config);
    if (wp.hash !== state.tracking.waypointsHash) {
      response.push(wp.command);
      state = { ...state, tracking: { ...state.tracking, waypointsHash: wp.hash } };
    }
    await this.persist({ session, sessionId, config }, state);
    return response;
  }

}
