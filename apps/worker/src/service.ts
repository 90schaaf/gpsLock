/**
 * Worker adapter around the shared application service (`LockationApp` in @lockation/core):
 * resolves tokens via the Chaster API, implements the ports with Chaster + D1 + ntfy, and handles what only the
 * worker does – configuration endpoints, ntfy channels, the OwnTracks HTTP protocol and the cron.
 */
import {
  computeMetadata,
  type CheckinPurpose,
  type CheckinRecord,
  type Fix,
  type HuntAction,
  type MissionAction,
  KNOWN_COMMANDS,
  loadState,
  type LockationConfig,
  LockationApp,
  type LockSession,
  type LockationState,
  nextDueAt,
  owntracksConfigLink,
  owntracksLocatorInterval,
  owntracksMonitoring,
  owntracksSetMonitoring,
  owntracksWaypoints,
  parseConfig,
  parseConfigOrDefault,
  parseOwnTracks,
  type Role,
  type SessionView,
  type TrackedInput,
} from '@lockation/core';
import { applyAll } from './apply.js';
import { sessionIdOf, type ChasterClient, type ChasterSession } from './chaster.js';
import { deliverNotices, type Ntfy, NtfyError } from './notify.js';
import type { Store } from './store.js';
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

/** A lock session as handled by the worker (keeps the raw Chaster session for data writes). */
interface WorkerSession extends LockSession {
  session: ChasterSession;
}

interface Resolved extends WorkerSession {
  role: Role;
}

export class LockationService {
  private client: ChasterClient;
  private store: Store;
  private ntfy?: Ntfy;
  private appUrl?: string;
  private now: () => Date;
  readonly app: LockationApp<WorkerSession>;

  constructor(deps: ServiceDeps) {
    this.client = deps.client;
    this.store = deps.store;
    this.ntfy = deps.ntfy;
    this.appUrl = deps.appUrl;
    const now = (this.now = deps.now ?? (() => new Date()));
    const rng = deps.rng ?? Math.random;
    const newId = deps.newId ?? (() => crypto.randomUUID());
    const client = this.client;
    const store = this.store;
    this.app = new LockationApp<WorkerSession>({
      now,
      newId,
      rng,
      async saveState(s, state) {
        await client.setData(s.sessionId, { ...(s.session.data ?? {}), [STATE_KEY]: state });
        s.session.data = { ...(s.session.data ?? {}), [STATE_KEY]: state };
        s.state = state;
        await store.setDue(s.sessionId, nextDueAt(s.config, state, now()));
        try {
          await client.setMetadata(s.sessionId, computeMetadata(s.config, state, now()));
        } catch {
          /* metadata is cosmetic – never fail the request because of it */
        }
      },
      idle: (s) => store.setDue(s.sessionId, nextDueAt(s.config, s.state, now())),
      applyConsequences: (s, list) => applyAll(client, s.sessionId, list),
      log: (s, entry) => client.customLog(s.sessionId, entry),
      appendHistory: (s, record) => store.appendHistory(s.sessionId, record),
      listHistory: (s) => store.listHistory(s.sessionId),
      redactHistory: (s) => store.redactHistory(s.sessionId),
      deliver: async (s, notices) => {
        await deliverNotices({ ntfy: this.ntfy, store, sessionId: s.sessionId, config: s.config, isSelfLock: s.isSelfLock, notices, now: now(), click: this.appUrl });
      },
      notificationStatus: async (s, audience) => ({ available: !!this.ntfy, subscribed: !!(this.ntfy && (await store.topic(s.sessionId, audience))) }),
    });
  }

  // ---------- helpers ----------
  private sessionOf(session: ChasterSession, config: LockationConfig = parseConfigOrDefault(session.config)): WorkerSession {
    const start = new Date(session.lock?.startDate ?? session.createdAt ?? this.now().toISOString());
    return {
      session,
      sessionId: sessionIdOf(session),
      config,
      isSelfLock: !session.lock?.keyholder,
      locked: !session.lock?.status || session.lock.status === 'locked',
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
    return { role: auth.role, ...this.sessionOf(auth.session) };
  }

  // ---------- main page ----------
  async sessionView(mainToken: string): Promise<SessionView> {
    const r = await this.resolve(mainToken);
    return this.app.view(r, r.role);
  }

  async checkin(mainToken: string, fix: Fix, purpose: CheckinPurpose): Promise<{ record: CheckinRecord; view: SessionView }> {
    const r = await this.resolve(mainToken);
    return this.app.checkin(r, r.role, fix, purpose);
  }

  async downgradePrivacy(mainToken: string): Promise<SessionView> {
    const r = await this.resolve(mainToken);
    return this.app.downgradePrivacy(r, r.role);
  }

  /** Wearer saw the "rules changed" summary. */
  async ackRulesChanged(mainToken: string): Promise<SessionView> {
    const r = await this.resolve(mainToken);
    return this.app.ackRulesChanged(r, r.role);
  }

  async huntAction(mainToken: string, action: HuntAction): Promise<SessionView> {
    const r = await this.resolve(mainToken);
    return this.app.huntAction(r, r.role, action);
  }

  async missionAction(mainToken: string, action: MissionAction): Promise<SessionView> {
    const r = await this.resolve(mainToken);
    return this.app.missionAction(r, r.role, action);
  }

  // ---------- notifications (ntfy) ----------
  async setupNotifications(mainToken: string) {
    const r = await this.resolve(mainToken);
    if (!this.ntfy) throw new HttpError(503, 'notifications_unavailable', 'Notifications are not configured on this server.');
    const audience = this.app.audience(r, r.role);
    const topic = await this.store.createTopic(r.sessionId, audience, this.now());
    await this.ntfy
      .send(topic, { title: '✅ Lockation test notification', message: audience === 'wearer' ? 'Notifications are set up. Warnings for your lock will arrive here.' : 'Notifications are set up. Updates about your wearer\'s lock will arrive here.', click: this.appUrl })
      .catch(() => undefined);
    return { topic, ...this.ntfy.links(topic), view: await this.app.view(r, r.role) };
  }

  /** Sends a test message to the caller's own notification channel. */
  async testNotification(mainToken: string): Promise<{ ok: true }> {
    const r = await this.resolve(mainToken);
    if (!this.ntfy) throw new HttpError(503, 'notifications_unavailable', 'Notifications are not configured on this server.');
    const topic = await this.store.topic(r.sessionId, this.app.audience(r, r.role));
    if (!topic) throw new HttpError(409, 'not_subscribed', 'Set up notifications first.');
    try {
      await this.ntfy.send(topic, { title: '✅ Lockation test notification', message: 'Notifications work. Warnings and updates for this lock will arrive here.', click: this.appUrl });
    } catch (e) {
      if (e instanceof NtfyError) throw new HttpError(502, 'ntfy_failed', `Notification server answered ${e.status}${e.detail ? ` (${e.detail})` : ''}. ${e.hint}`);
      throw new HttpError(502, 'ntfy_failed', `The notification server could not be reached (${e instanceof Error ? e.message : String(e)}).`);
    }
    return { ok: true };
  }

  async stopNotifications(mainToken: string): Promise<SessionView> {
    const r = await this.resolve(mainToken);
    await this.store.removeTopic(r.sessionId, this.app.audience(r, r.role));
    return this.app.view(r, r.role);
  }

  // ---------- configuration page ----------
  /** Loads the configuration for a token; only the wearer or keyholder may use the configuration page. */
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
    const current = await this.configuration(configToken);
    const before = parseConfigOrDefault(current.config);
    LockationApp.checkSave(before, parsed.config, !!current.sessionId);
    await this.client.putConfiguration(configToken, parsed.config);
    if (current.sessionId) {
      try {
        const session = await this.client.getSession(current.sessionId);
        await this.app.announceChanges(this.sessionOf({ ...session, config: parsed.config }, parsed.config), before);
      } catch (e) {
        console.error('change notice failed', e);
      }
    }
    return { ok: true as const, config: parsed.config };
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
  tickSession(session: ChasterSession): Promise<boolean> {
    return this.app.tick(this.sessionOf(session), { hadState: !!session.data?.[STATE_KEY] });
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
    if (session.data?.[STATE_KEY]) return;
    const s = this.sessionOf(session);
    const start = new Date(session.lock?.startDate ?? session.createdAt ?? this.now().toISOString());
    await this.app.initialize(s, start);
  }

  async onSessionDeleted(sessionId: string) {
    await this.store.purgeSession(sessionId);
  }

  // ---------- background tracking (OwnTracks) ----------
  async pairTracking(mainToken: string, endpointUrl: string) {
    const r = await this.resolve(mainToken);
    if (r.role !== 'wearer') throw new HttpError(403, 'not_wearer', 'Only the wearer can set up background tracking.');
    if (!r.locked) throw new HttpError(409, 'not_locked', 'The lock is not running.');
    if (!r.config.tracking.enabled) throw new HttpError(409, 'tracking_disabled', 'Background tracking is not enabled for this lock.');
    const creds = await this.store.createDevice(r.sessionId, this.now());
    const monitoring = owntracksMonitoring(r.config);
    const locatorInterval = owntracksLocatorInterval(r.config);
    const view = await this.app.paired(r, r.role, creds.username, { monitoring, locatorInterval });
    const opts = { url: endpointUrl, username: creds.username, password: creds.password };
    return { link: owntracksConfigLink({ ...opts, monitoring, locatorInterval }), ...opts, view };
  }

  async unpairTracking(mainToken: string): Promise<SessionView> {
    const r = await this.resolve(mainToken);
    if (r.role === 'wearer') await this.store.removeDevice(r.sessionId);
    return this.app.unpaired(r, r.role);
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
    const s = this.sessionOf(session);
    if (!s.locked) return [];
    if (s.state.tracking.deviceUser !== username) {
      await this.store.removeDevice(s.sessionId);
      throw new HttpError(401, 'unauthorized', 'Device was revoked.');
    }
    if (!s.config.tracking.enabled) return [];

    const messages = Array.isArray(body) ? body : [body];
    const inputs = messages.map((m) => parseOwnTracks(m, s.config, s.state)).filter((x): x is TrackedInput => !!x);
    const response: unknown[] = [];
    await this.app.tracked(s, inputs, {
      beforeSave: (state: LockationState) => {
        let next = state;
        const wp = owntracksWaypoints(s.config, next);
        if (wp.hash !== next.tracking.waypointsHash) {
          response.push(wp.command);
          next = { ...next, tracking: { ...next.tracking, waypointsHash: wp.hash } };
        }
        const monitoring = owntracksMonitoring(s.config);
        const locatorInterval = owntracksLocatorInterval(s.config);
        if (next.tracking.monitoring !== monitoring || (next.tracking.locatorInterval ?? 300) !== locatorInterval) {
          response.push(owntracksSetMonitoring(monitoring, locatorInterval));
          next = { ...next, tracking: { ...next.tracking, monitoring, locatorInterval } };
        }
        return next;
      },
    });
    return response;
  }
}
