/** Application service: orchestrates Chaster API, core engine, storage and notifications. */
import {
  applyHuntAction,
  buildLogEntry,
  type HuntAction,
  HuntActionError,
  buildSessionView,
  computeMetadata,
  diffConfig,
  disclaimerAccepted,
  evaluateCheckin,
  evaluateTick,
  evaluateTracked,
  initialState,
  isLiveOnly,
  KNOWN_COMMANDS,
  loadState,
  nextDueAt,
  type Notice,
  owntracksConfigLink,
  owntracksMonitoring,
  owntracksSetMonitoring,
  owntracksWaypoints,
  parseConfig,
  parseConfigOrDefault,
  parseOwnTracks,
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
import { deliverNotices, type Ntfy } from './notify.js';
import type { Audience, Store } from './store.js';
import { HttpError } from './types.js';

export const STATE_KEY = 'lockation';

export interface ServiceDeps {
  client: ChasterClient;
  store: Store;
  ntfy?: Ntfy;
  /** Check-in page URL (notification click target). */
  appUrl?: string;
  now?: () => Date;
  rng?: () => number;
  newId?: () => string;
}

interface Ctx {
  session: ChasterSession;
  sessionId: string;
  config: LockationConfig;
  isSelfLock: boolean;
}

interface Resolved extends Ctx {
  role: 'wearer' | 'keyholder';
  state: LockationState;
}

export class LockationService {
  private client: ChasterClient;
  private store: Store;
  private ntfy?: Ntfy;
  private appUrl?: string;
  private now: () => Date;
  private rng: () => number;
  private newId: () => string;

  constructor(deps: ServiceDeps) {
    this.client = deps.client;
    this.store = deps.store;
    this.ntfy = deps.ntfy;
    this.appUrl = deps.appUrl;
    this.now = deps.now ?? (() => new Date());
    this.rng = deps.rng ?? Math.random;
    this.newId = deps.newId ?? (() => crypto.randomUUID());
  }

  // ---------- helpers ----------
  private ctxOf(session: ChasterSession): Ctx & { state: LockationState } {
    const config = parseConfigOrDefault(session.config);
    const start = new Date(session.lock?.startDate ?? session.createdAt ?? this.now().toISOString());
    return {
      session,
      sessionId: sessionIdOf(session),
      config,
      isSelfLock: !session.lock?.keyholder,
      state: loadState(session.data?.[STATE_KEY], config, start, this.now()),
    };
  }

  private async resolve(mainToken: string): Promise<Resolved> {
    if (!mainToken) throw new HttpError(401, 'missing_token', 'mainToken is required');
    const auth = await this.client.authSession(mainToken);
    // Security: only the wearer and the keyholder of this lock may see zones, locations and history.
    if (auth.role !== 'wearer' && auth.role !== 'keyholder') {
      throw new HttpError(403, 'not_allowed', 'Only the wearer and the keyholder of this lock can open Lockation.');
    }
    return { role: auth.role, ...this.ctxOf(auth.session) };
  }

  private async persist(c: Ctx, state: LockationState) {
    await this.client.setData(c.sessionId, { ...(c.session.data ?? {}), [STATE_KEY]: state });
    c.session.data = { ...(c.session.data ?? {}), [STATE_KEY]: state };
    await this.store.setDue(c.sessionId, nextDueAt(c.config, state, this.now()));
    try {
      await this.client.setMetadata(c.sessionId, computeMetadata(c.config, state, this.now()));
    } catch {
      /* metadata is cosmetic – never fail the request because of it */
    }
  }

  /** Apply, log, persist and notify the result of one evaluation. */
  private async finish(c: Ctx, result: EvalResult & { record?: CheckinRecord }, kind: 'checkin' | 'tick', opts: { history?: boolean } = {}) {
    let applied: { ok: boolean; error?: string }[] = [];
    if (result.consequences.length) applied = await applyAll(this.client, c.sessionId, result.consequences);
    if (result.record) result.record.consequences = result.record.consequences.map((x, i) => ({ ...x, ok: applied[i]?.ok, error: applied[i]?.error }));
    const log = buildLogEntry(kind, result.events, result.consequences, result.record);
    if (log) await this.client.customLog(c.sessionId, log).catch(() => undefined);
    await this.persist(c, result.state);
    if (result.record && opts.history !== false) await this.store.appendHistory(c.sessionId, result.record);
    await this.notify(c, result.notices);
  }

  private notify(c: Ctx, notices: Notice[]) {
    return deliverNotices({ ntfy: this.ntfy, store: this.store, sessionId: c.sessionId, config: c.config, isSelfLock: c.isSelfLock, notices, now: this.now(), click: this.appUrl });
  }

  private audience(r: Resolved): Audience {
    return r.isSelfLock ? 'wearer' : r.role;
  }

  private async view(r: Resolved, state: LockationState): Promise<SessionView> {
    const history = await this.store.listHistory(r.sessionId);
    const view = buildSessionView({ role: r.role, isSelfLock: r.isSelfLock, config: r.config, state, history, now: this.now() });
    view.notifications = { available: !!this.ntfy, subscribed: !!(this.ntfy && (await this.store.topic(r.sessionId, this.audience(r)))) };
    return view;
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
    const result = evaluateCheckin(r.config, r.state, fix, { now: this.now(), sessionId: r.sessionId, evalId: this.newId(), rng: this.rng }, purpose);
    await this.finish(r, result, 'checkin');
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
    await this.store.redactHistory(r.sessionId);
    await this.client
      .customLog(r.sessionId, { title: 'Lockation privacy', description: 'Exact coordinates are no longer shared for this lock.', icon: 'user-secret' })
      .catch(() => undefined);
    return this.view(r, state);
  }

  /** Wearer saw the "rules changed" summary. */
  async ackRulesChanged(mainToken: string): Promise<SessionView> {
    const r = await this.resolve(mainToken);
    if (r.role !== 'wearer') throw new HttpError(403, 'not_wearer', 'Only the wearer can acknowledge rule changes.');
    const state: LockationState = { ...r.state, rulesChanged: undefined };
    await this.persist(r, state);
    return this.view(r, state);
  }

  // ---------- notifications (ntfy) ----------
  async setupNotifications(mainToken: string) {
    const r = await this.resolve(mainToken);
    if (!this.ntfy) throw new HttpError(503, 'notifications_unavailable', 'Notifications are not configured on this server.');
    const audience = this.audience(r);
    const topic = await this.store.createTopic(r.sessionId, audience, this.now());
    await this.ntfy
      .send(topic, { title: '✅ Lockation test notification', message: audience === 'wearer' ? 'Notifications are set up. Warnings for your lock will arrive here.' : 'Notifications are set up. Updates about your wearer\'s lock will arrive here.', click: this.appUrl })
      .catch(() => undefined);
    return { topic, ...this.ntfy.links(topic), view: await this.view(r, r.state) };
  }

  /** Sends a test message to the caller's own notification channel. */
  async testNotification(mainToken: string): Promise<{ ok: true }> {
    const r = await this.resolve(mainToken);
    if (!this.ntfy) throw new HttpError(503, 'notifications_unavailable', 'Notifications are not configured on this server.');
    const topic = await this.store.topic(r.sessionId, this.audience(r));
    if (!topic) throw new HttpError(409, 'not_subscribed', 'Set up notifications first.');
    try {
      await this.ntfy.send(topic, { title: '✅ Lockation test notification', message: 'Notifications work. Warnings and updates for this lock will arrive here.', click: this.appUrl });
    } catch {
      throw new HttpError(502, 'ntfy_failed', 'The notification server did not accept the message. Check the NTFY_TOKEN secret.');
    }
    return { ok: true };
  }

  // ---------- scavenger hunt control ----------
  async huntAction(mainToken: string, action: HuntAction): Promise<SessionView> {
    const r = await this.resolve(mainToken);
    if (r.session.lock?.status && r.session.lock.status !== 'locked') throw new HttpError(409, 'not_locked', 'The lock is not running.');
    let result: EvalResult;
    try {
      result = applyHuntAction(r.config, r.state, action, r.role, { now: this.now(), sessionId: r.sessionId, evalId: this.newId(), rng: this.rng }, r.isSelfLock);
    } catch (e) {
      if (e instanceof HuntActionError) throw new HttpError(403, 'hunt_action_not_allowed', e.message);
      throw e;
    }
    await this.finish(r, result, 'tick');
    return this.view(r, result.state);
  }

  async stopNotifications(mainToken: string): Promise<SessionView> {
    const r = await this.resolve(mainToken);
    await this.store.removeTopic(r.sessionId, this.audience(r));
    return this.view(r, r.state);
  }

  // ---------- configuration page ----------
  /** Loads the configuration for a token; only the wearer or keyholder may use the configuration page (F19). */
  private async configuration(configToken: string) {
    const c = await this.client.getConfiguration(configToken);
    if (c.role !== 'wearer' && c.role !== 'keyholder') {
      throw new HttpError(403, 'not_allowed', 'Only the wearer and the keyholder of this lock can configure Lockation.');
    }
    return c;
  }

  async configGet(configToken: string) {
    if (!configToken) throw new HttpError(401, 'missing_token', 'configToken is required');
    const c = await this.configuration(configToken);
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
    const current = await this.configuration(configToken);
    const before = parseConfigOrDefault(current.config);
    if (current.sessionId) {
      // F9 AC3: privacy cannot be upgraded while a session is running.
      if (before.privacy.coordinates === 'zone_only' && parsed.config.privacy.coordinates === 'exact') {
        throw new HttpError(403, 'privacy_upgrade', 'Coordinate sharing cannot be enabled while the lock is running.');
      }
    }
    await this.client.putConfiguration(configToken, parsed.config);
    if (current.sessionId) await this.announceChanges(current.sessionId, before, parsed.config).catch((e) => console.error('change notice failed', e));
    return { ok: true as const, config: parsed.config };
  }

  /** Mid-lock configuration change: history entry, wearer notification and "rules changed" notice. */
  private async announceChanges(sessionId: string, before: LockationConfig, after: LockationConfig) {
    const summary = diffConfig(before, after);
    if (!summary.length) return;
    const session = await this.client.getSession(sessionId);
    if (session.lock?.status && session.lock.status !== 'locked') return;
    const c = this.ctxOf({ ...session, config: after });
    const now = this.now();
    const state: LockationState = { ...c.state, rulesChanged: { at: now.toISOString(), summary } };
    await this.persist(c, state);
    await this.client.customLog(sessionId, { title: 'Lockation rules changed', description: summary.join('\n').slice(0, 2000), icon: 'edit' }).catch(() => undefined);
    await this.notify(c, [
      { audience: 'wearer', title: 'Lockation rules changed', message: summary.slice(0, 8).join('\n'), priority: 'default', key: `rules:${now.toISOString()}` },
    ]);
  }

  async capabilities(opts: { mainToken?: string; configToken?: string }) {
    let sessionId: string | null = null;
    if (opts.mainToken) sessionId = (await this.resolve(opts.mainToken)).sessionId;
    else if (opts.configToken) sessionId = (await this.configuration(opts.configToken)).sessionId;
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
  /** Evaluate deadlines, warnings and escalations for one session; returns true when consequences were applied. */
  async tickSession(session: ChasterSession): Promise<boolean> {
    const c = this.ctxOf(session);
    const hadState = !!session.data?.[STATE_KEY];
    const now = this.now();
    const result: EvalResult = evaluateTick(c.config, c.state, { now, sessionId: c.sessionId, evalId: `tick-${now.toISOString()}`, rng: this.rng });
    if (tickIsNoop(result) && hadState && JSON.stringify(result.state) === JSON.stringify(c.state)) {
      await this.store.setDue(c.sessionId, nextDueAt(c.config, c.state, now));
      return false;
    }
    await this.finish(c, result, 'tick');
    return result.consequences.length > 0;
  }

  /** Tick one session by id (1-minute cron). Removes the due entry when the session is gone. */
  async tickSessionById(sessionId: string): Promise<boolean> {
    try {
      const s = await this.client.getSession(sessionId);
      if (s.lock?.status && s.lock.status !== 'locked') {
        await this.store.setDue(sessionId, undefined);
        return false;
      }
      return await this.tickSession(s);
    } catch (e) {
      if (e instanceof HttpError && e.status === 404) {
        await this.store.setDue(sessionId, undefined);
        return false;
      }
      throw e;
    }
  }

  async initSession(session: ChasterSession) {
    const c = this.ctxOf(session);
    if (session.data?.[STATE_KEY]) return;
    const start = new Date(session.lock?.startDate ?? session.createdAt ?? this.now().toISOString());
    await this.persist(c, initialState(c.config, start));
  }

  async onSessionDeleted(sessionId: string) {
    await this.store.purgeSession(sessionId);
  }

  // ---------- F14 background tracking ----------
  async pairTracking(mainToken: string, endpointUrl: string) {
    const r = await this.resolve(mainToken);
    if (r.role !== 'wearer') throw new HttpError(403, 'not_wearer', 'Only the wearer can set up background tracking.');
    if (r.session.lock?.status && r.session.lock.status !== 'locked') throw new HttpError(409, 'not_locked', 'The lock is not running.');
    if (!r.config.tracking.enabled) throw new HttpError(409, 'tracking_disabled', 'Background tracking is not enabled for this lock.');
    const now = this.now();
    const creds = await this.store.createDevice(r.sessionId, now);
    const monitoring = owntracksMonitoring(r.config);
    const state: LockationState = {
      ...r.state,
      tracking: { ...r.state.tracking, deviceUser: creds.username, pairedAt: now.toISOString(), waypointsHash: undefined, monitoring },
    };
    await this.persist(r, state);
    await this.client
      .customLog(r.sessionId, { title: 'Lockation tracking', description: 'Background tracking was set up (OwnTracks).', icon: 'satellite-dish' })
      .catch(() => undefined);
    await this.notify(r, [{ audience: 'keyholder', kind: 'tracking', title: 'Lockation: tracking set up', message: 'The wearer set up background tracking (waiting for the first location).', priority: 'default', key: `tracking:paired:${now.toISOString()}` }]);
    const opts = { url: endpointUrl, username: creds.username, password: creds.password };
    return { link: owntracksConfigLink({ ...opts, monitoring }), ...opts, view: await this.view(r, state) };
  }

  async unpairTracking(mainToken: string): Promise<SessionView> {
    const r = await this.resolve(mainToken);
    if (r.role !== 'wearer') throw new HttpError(403, 'not_wearer', 'Only the wearer can stop background tracking.');
    await this.store.removeDevice(r.sessionId);
    const state: LockationState = { ...r.state, tracking: { ...r.state.tracking, deviceUser: undefined, pairedAt: undefined } };
    await this.persist(r, state);
    await this.client
      .customLog(r.sessionId, { title: 'Lockation tracking', description: 'Background tracking was stopped by the wearer.', icon: 'satellite-dish' })
      .catch(() => undefined);
    const now = this.now();
    await this.notify(r, [{ audience: 'keyholder', kind: 'tracking', title: 'Lockation: tracking stopped', message: 'The wearer stopped background tracking.', priority: 'high', key: `tracking:stopped:${now.toISOString()}` }]);
    return this.view(r, state);
  }

  /** Handle one OwnTracks HTTP POST. Returns the JSON array to send back to the app. */
  async ingestOwnTracks(username: string, password: string, body: unknown): Promise<unknown[]> {
    const dev = await this.store.verifyDevice(username, password);
    if (!dev) throw new HttpError(401, 'unauthorized', 'Unknown device.');
    let session: ChasterSession;
    try {
      session = await this.client.getSession(dev.sessionId);
    } catch (e) {
      if (e instanceof HttpError && e.status === 404) {
        await this.store.removeDevice(dev.sessionId);
        throw new HttpError(401, 'unauthorized', 'Session ended.');
      }
      throw e;
    }
    if (session.lock?.status && session.lock.status !== 'locked') return [];
    const c = this.ctxOf(session);
    let state = c.state;
    if (state.tracking.deviceUser !== username) {
      await this.store.removeDevice(c.sessionId);
      throw new HttpError(401, 'unauthorized', 'Device was revoked.');
    }
    if (!c.config.tracking.enabled) return [];

    const messages = Array.isArray(body) ? body : [body];
    const notices: Notice[] = [];
    for (const m of messages) {
      const input = parseOwnTracks(m, c.config);
      if (!input) continue;
      const result = evaluateTracked(c.config, state, input, { now: this.now(), sessionId: c.sessionId, evalId: this.newId(), rng: this.rng });
      state = result.state;
      if (result.consequences.length) {
        const applied = await applyAll(this.client, c.sessionId, result.consequences);
        result.record.consequences = result.record.consequences.map((x, i) => ({ ...x, ok: applied[i]?.ok, error: applied[i]?.error }));
      }
      if (result.consequences.length || result.notices.some((n) => n.audience === 'wearer')) {
        const log = buildLogEntry('checkin', result.events, result.consequences, result.record);
        if (log) await this.client.customLog(c.sessionId, log).catch(() => undefined);
      }
      if (result.notable) await this.store.appendHistory(c.sessionId, result.record);
      notices.push(...result.notices);
    }

    const response: unknown[] = [];
    const wp = owntracksWaypoints(c.config, state);
    if (wp.hash !== state.tracking.waypointsHash) {
      response.push(wp.command);
      state = { ...state, tracking: { ...state.tracking, waypointsHash: wp.hash } };
    }
    const monitoring = owntracksMonitoring(c.config);
    if (state.tracking.monitoring !== monitoring) {
      response.push(owntracksSetMonitoring(monitoring));
      state = { ...state, tracking: { ...state.tracking, monitoring } };
    }
    await this.persist(c, state);
    await this.notify(c, notices);
    return response;
  }
}
