/**
 * The rule engine. Pure functions: (config, state, input, context) → result.
 * No I/O; the worker / demo backend apply the planned consequences and deliver the notices.
 */
import {
  type Checkpoint,
  forbiddenTimings,
  type KeyholderNotifyKind,
  type LockationConfig,
  matchModeOf,
  type Zone,
  zonesWithRole,
} from './config.js';
import { appliesAt, type Consequence, describeConsequence, scaleConsequence } from './consequences.js';
import { distanceBand, haversineM, isInside, roundCoord } from './geo.js';
import {
  cloneState,
  computeDeadline,
  effectivePrivacy,
  type LockationState,
  nextHeartbeatFrom,
  type RequiredSlot,
  requiredSlots,
  syncSlots,
  type VisitState,
} from './state.js';
import { activeWindowStart, adjustForQuietHours, dayKey, formatLocalTime, isInQuietHours, MINUTE } from './time.js';

export interface Fix {
  lat: number;
  lng: number;
  /** Accuracy radius in metres (68 % confidence, as reported by the browser). */
  accuracy: number;
  /** Epoch ms when the device obtained the fix. */
  timestamp: number;
}

export type CheckinPurpose = 'general' | 'hunt';
export type ObservationSource = 'manual' | 'tracked';

export interface EvalContext {
  now: Date;
  sessionId: string;
  /** Unique id of this evaluation (check-in id or tick id); used for idempotency keys. */
  evalId: string;
  /** Random number generator in [0, 1). Injected for deterministic tests. */
  rng?: () => number;
}

export interface PlannedConsequence {
  consequence: Consequence;
  /** Which rule produced it, e.g. `required.onMissed`. */
  source: string;
  idempotencyKey: string;
}

/**
 * A push notification (ntfy) produced by an evaluation. Wearer notices are warnings; keyholder notices are filtered
 * by `config.notifications.keyholder[kind]` and combined per evaluation by the worker. Texts never contain coordinates.
 */
export interface Notice {
  audience: 'wearer' | 'keyholder';
  /** Keyholder switch the notice belongs to (keyholder notices only). */
  kind?: KeyholderNotifyKind;
  title: string;
  message: string;
  priority: 'default' | 'high';
  /** Stable key (dedupe/rate limit), e.g. `forbidden:bar:<since>:warn:0`. */
  key: string;
  zoneId?: string;
}

export type RejectReason = 'rate_limited' | 'stale_fix' | 'future_fix' | 'poor_accuracy' | 'implausible_speed' | 'out_of_order' | 'manual_disabled';

export interface CheckinRecord {
  id: string;
  at: string;
  outcome: 'accepted' | 'rejected';
  reason?: RejectReason;
  accuracy: number;
  lat?: number;
  lng?: number;
  purpose: CheckinPurpose;
  /** `tracked` = background update from OwnTracks (F14). Missing = manual check-in. */
  source?: ObservationSource;
  zones: string[];
  events: string[];
  flagged?: 'implausible_speed';
  consequences: { type: Consequence['type']; source: string; description: string; ok?: boolean; error?: string }[];
}

export interface EvalResult {
  state: LockationState;
  consequences: PlannedConsequence[];
  events: string[];
  notices: Notice[];
}

export interface CheckinResult extends EvalResult {
  record: CheckinRecord;
}

export interface TrackedInput {
  fix?: Fix;
  /** OwnTracks region transition, resolved by the caller to a zone or a hunt checkpoint. */
  transition?: { event: 'enter' | 'leave'; zoneId?: string; checkpointId?: string; at: number };
}

export interface TrackedResult extends CheckinResult {
  /** Whether this observation is worth recording in history / logs. */
  notable: boolean;
}

/** Sources whose consequences count as a penalty (keyholder "penalty applied" notification). */
const PENALTY_SOURCES = new Set([
  'required.onMissed',
  'required.onOutside',
  'required.onOutsideDuringWindow',
  'forbidden.onEnter',
  'tracking.onHeartbeatMissed',
  'hunt.onWrong',
  'hunt.onTimeout',
  'antiCheat.implausible',
]);

class Planner {
  readonly list: PlannedConsequence[] = [];
  readonly events: string[] = [];
  readonly notices: Notice[] = [];
  constructor(private readonly ctx: EvalContext) {}

  add(source: string, consequences: Consequence[], factor = 1, keySuffix = '') {
    for (const c of consequences) {
      const idx = this.list.length;
      this.list.push({
        consequence: scaleConsequence(c, factor),
        source,
        idempotencyKey: `${this.ctx.sessionId}:${this.ctx.evalId}${keySuffix}:${idx}`,
      });
    }
  }

  /** Add with an idempotency key that is stable across retries (cron, repeated observations). */
  addStable(source: string, consequences: Consequence[], stableKey: string) {
    consequences.forEach((c, i) => {
      this.list.push({ consequence: c, source, idempotencyKey: `${this.ctx.sessionId}:${stableKey}:${i}` });
    });
  }

  event(msg: string) {
    this.events.push(msg);
  }

  notify(n: Omit<Notice, 'priority'> & { priority?: Notice['priority'] }) {
    this.notices.push({ priority: 'default', ...n });
  }

  /** Keyholder notices derived from the planned consequences (penalties, verification pictures). */
  finish(): Notice[] {
    const penalties = this.list.filter((p) => PENALTY_SOURCES.has(p.source));
    if (penalties.length) {
      this.notify({
        audience: 'keyholder',
        kind: 'penalty',
        title: 'Lockation: penalty applied',
        message: `${penalties.map((p) => describeConsequence(p.consequence)).join(', ')}.`,
        key: `penalty:${penalties[0]!.idempotencyKey}`,
      });
    }
    const vp = this.list.find((p) => p.consequence.type === 'verification_picture');
    if (vp) {
      this.notify({ audience: 'keyholder', kind: 'verification', title: 'Lockation: verification picture', message: 'A verification picture was requested from the wearer.', key: `vp:${vp.idempotencyKey}` });
    }
    return this.notices;
  }
}

const msSince = (iso: string | undefined, now: Date) => (iso ? now.getTime() - Date.parse(iso) : Infinity);
const list = (cs: Consequence[]) => (cs.length ? cs.map(describeConsequence).join(', ') : 'nothing');

function zonesById(config: LockationConfig): Map<string, Zone> {
  return new Map(config.zones.map((z) => [z.id, z]));
}

/** F8 – timestamp, accuracy and rate checks for manual check-ins. Returns a reject reason or undefined. */
export function preCheck(config: LockationConfig, state: LockationState, fix: Fix, now: Date): RejectReason | undefined {
  const ac = config.antiCheat;
  if (state.lastAccepted && msSince(state.lastAccepted.at, now) < ac.minIntervalSeconds * 1000) return 'rate_limited';
  const age = now.getTime() - fix.timestamp;
  if (age > ac.maxFixAgeSeconds * 1000) return 'stale_fix';
  if (age < -30_000) return 'future_fix';
  if (!(fix.accuracy >= 0) || fix.accuracy > ac.maxAccuracyM) return 'poor_accuracy';
  return undefined;
}

/** F14 – checks for background positions (queued positions are allowed, rate limit is not applied). */
export function preCheckTracked(config: LockationConfig, state: LockationState, fix: Fix, now: Date): RejectReason | undefined {
  if (state.lastAccepted && fix.timestamp < Date.parse(state.lastAccepted.at)) return 'out_of_order';
  const age = now.getTime() - fix.timestamp;
  if (age > config.tracking.maxDelayMinutes * MINUTE) return 'stale_fix';
  if (age < -30_000) return 'future_fix';
  if (!(fix.accuracy >= 0) || fix.accuracy > config.antiCheat.maxAccuracyM) return 'poor_accuracy';
  return undefined;
}

/** F8 – speed plausibility relative to the last accepted fix. Returns km/h (0 when not computable). */
export function impliedSpeedKmh(state: LockationState, fix: Fix): number {
  const prev = state.lastAccepted;
  if (!prev) return 0;
  const dt = Math.max(1, (fix.timestamp - Date.parse(prev.at)) / 1000);
  const d = Math.max(0, haversineM(prev, fix) - prev.accuracy - fix.accuracy);
  return (d / dt) * 3.6;
}

function newRecord(config: LockationConfig, state: LockationState, id: string, at: Date, fix: Fix | undefined, purpose: CheckinPurpose, events: string[]): CheckinRecord {
  const record: CheckinRecord = {
    id,
    at: at.toISOString(),
    outcome: 'accepted',
    accuracy: fix ? Math.round(fix.accuracy) : 0,
    purpose,
    zones: [],
    events,
    consequences: [],
  };
  if (fix && effectivePrivacy(config, state) === 'exact') {
    record.lat = fix.lat;
    record.lng = fix.lng;
  }
  return record;
}

function storeLastAccepted(config: LockationConfig, state: LockationState, fix: Fix, now: Date) {
  const exact = effectivePrivacy(config, state) === 'exact';
  const p = exact ? { lat: fix.lat, lng: fix.lng } : { lat: roundCoord(fix.lat), lng: roundCoord(fix.lng) };
  state.lastAccepted = { ...p, accuracy: Math.round(fix.accuracy), at: new Date(Math.min(fix.timestamp, now.getTime())).toISOString() };
}

/** F16 – manual check-ins disabled, location only via background tracking. */
export function isLiveOnly(config: LockationConfig): boolean {
  return config.tracking.enabled && config.tracking.liveOnly;
}

export function evaluateCheckin(
  config: LockationConfig,
  prevState: LockationState,
  fix: Fix,
  ctx: EvalContext,
  purpose: CheckinPurpose = 'general',
): CheckinResult {
  const state = cloneState(prevState);
  const plan = new Planner(ctx);
  const now = ctx.now;
  syncSlots(config, state, now);
  state.checkinCount += 1;
  state.lastAttemptAt = now.toISOString();
  const record = newRecord(config, state, ctx.evalId, now, fix, purpose, plan.events);

  const reject = (reason: RejectReason, message: string): CheckinResult => {
    record.outcome = 'rejected';
    record.reason = reason;
    plan.event(message);
    finalizeRecord(record, plan.list);
    return { state, consequences: plan.list, events: plan.events, notices: plan.finish(), record };
  };

  if (isLiveOnly(config)) {
    return reject('manual_disabled', 'Manual check-ins are disabled for this lock – your location comes from live tracking (OwnTracks).');
  }

  const pre = preCheck(config, state, fix, now);
  if (pre === 'rate_limited') return reject(pre, `Too many check-ins – wait ${config.antiCheat.minIntervalSeconds}s between check-ins.`);
  if (pre === 'stale_fix') return reject(pre, 'The GPS position is outdated. Please try again.');
  if (pre === 'future_fix') return reject(pre, 'The GPS timestamp is in the future. Check your device clock.');
  if (pre === 'poor_accuracy') {
    return reject(pre, `GPS accuracy too low (±${Math.round(fix.accuracy)} m, needs ±${config.antiCheat.maxAccuracyM} m). Go outside or wait a moment.`);
  }

  // Speed plausibility
  let countDistance = true;
  const speed = impliedSpeedKmh(state, fix);
  if (speed > config.antiCheat.maxSpeedKmh) {
    record.flagged = 'implausible_speed';
    const mode = config.antiCheat.onImplausible;
    const msg = `Implausible movement detected (~${Math.round(speed)} km/h since last check-in).`;
    if (mode === 'reject') return reject('implausible_speed', msg);
    if (mode === 'reject_and_penalize') {
      plan.add('antiCheat.implausible', config.antiCheat.implausibleConsequences);
      return reject('implausible_speed', msg);
    }
    plan.event(`${msg} A verification picture is requested.`);
    plan.add('antiCheat.implausible', [{ type: 'verification_picture' }]);
    countDistance = false;
  }

  // ---- accepted ----
  state.acceptedCount += 1;
  runRules(config, state, fix, now, ctx, plan, record, { source: 'manual', purpose, countDistance });

  // Verification picture (F8) – manual check-ins only
  const vp = config.antiCheat.verificationPicture;
  const rng = ctx.rng ?? Math.random;
  const alreadyRequested = plan.list.some((p) => p.consequence.type === 'verification_picture');
  if (!alreadyRequested && (vp === 'always' || (vp === 'random' && rng() < config.antiCheat.verificationProbability))) {
    plan.event('A verification picture was requested for this check-in.');
    plan.add('antiCheat.verification', [{ type: 'verification_picture' }]);
  }

  if (!plan.events.length) plan.event(record.zones.length ? `Checked in at ${record.zones.join(', ')}.` : 'Checked in (no zone).');
  storeLastAccepted(config, state, fix, now);
  trackFreeze(state, plan.list, now);
  finalizeRecord(record, plan.list);
  return { state, consequences: plan.list, events: plan.events, notices: plan.finish(), record };
}

/** F14 – evaluate a background observation (OwnTracks location or transition). */
export function evaluateTracked(config: LockationConfig, prevState: LockationState, input: TrackedInput, ctx: EvalContext): TrackedResult {
  const state = cloneState(prevState);
  const plan = new Planner(ctx);
  const now = ctx.now;
  syncSlots(config, state, now);
  const fix = input.fix;
  const at = new Date(Math.min(fix?.timestamp ?? input.transition?.at ?? now.getTime(), now.getTime()));

  // Every authenticated message proves the device is alive (heartbeat).
  const wasConnected = !!state.tracking.lastSeenAt && (!state.tracking.pairedAt || state.tracking.lastSeenAt >= state.tracking.pairedAt);
  state.tracking.lastSeenAt = now.toISOString();
  state.tracking.trackedCount += 1;
  if (config.tracking.enabled) {
    state.tracking.nextHeartbeat = nextHeartbeatFrom(config, now).toISOString();
    if (!wasConnected) {
      plan.notify({ audience: 'keyholder', kind: 'tracking', title: 'Lockation: tracking connected', message: 'The wearer\'s phone sent its first background location.', key: `tracking:connected:${state.tracking.pairedAt ?? ''}` });
    }
  }

  const record = newRecord(config, state, ctx.evalId, at, fix, 'general', plan.events);
  record.source = 'tracked';
  const presenceBefore = Object.keys(state.presence).sort().join(',');
  const huntBefore = `${state.hunt.index}:${state.hunt.status}`;

  const reject = (reason: RejectReason, message: string): TrackedResult => {
    record.outcome = 'rejected';
    record.reason = reason;
    plan.event(message);
    finalizeRecord(record, plan.list);
    return { state, consequences: plan.list, events: plan.events, notices: plan.finish(), record, notable: plan.notices.length > 0 };
  };

  if (fix) {
    const pre = preCheckTracked(config, state, fix, now);
    if (pre) return reject(pre, `Background update ignored (${pre.replace(/_/g, ' ')}).`);
    const speed = impliedSpeedKmh(state, fix);
    if (speed > config.antiCheat.maxSpeedKmh) {
      record.flagged = 'implausible_speed';
      return reject('implausible_speed', `Background update ignored – implausible movement (~${Math.round(speed)} km/h).`);
    }
  } else if (now.getTime() - at.getTime() > config.tracking.maxDelayMinutes * MINUTE) {
    return reject('stale_fix', 'Background update ignored (stale fix).');
  }

  const t = input.transition;
  const forced = t?.zoneId ? { event: t.event, zoneId: t.zoneId } : undefined;
  const forcedCheckpoint = t?.checkpointId && t.event === 'enter' ? t.checkpointId : undefined;
  runRules(config, state, fix, at, ctx, plan, record, { source: 'tracked', purpose: 'general', countDistance: true, forced, forcedCheckpoint });
  if (fix) storeLastAccepted(config, state, fix, now);

  const presenceAfter = Object.keys(state.presence).sort().join(',');
  const notable = plan.list.length > 0 || plan.notices.length > 0 || presenceAfter !== presenceBefore || huntBefore !== `${state.hunt.index}:${state.hunt.status}`;
  if (presenceAfter !== presenceBefore) {
    const names = zonesById(config);
    const was = new Set(presenceBefore ? presenceBefore.split(',') : []);
    const is = new Set(presenceAfter ? presenceAfter.split(',') : []);
    for (const id of is) if (!was.has(id)) plan.event(`Entered "${names.get(id)?.name ?? id}".`);
    for (const id of was) if (!is.has(id)) plan.event(`Left "${names.get(id)?.name ?? id}".`);
  }
  if (!plan.events.length) plan.event(record.zones.length ? `Background update: in ${record.zones.join(', ')}.` : 'Background update.');

  trackFreeze(state, plan.list, now);
  finalizeRecord(record, plan.list);
  return { state, consequences: plan.list, events: plan.events, notices: plan.finish(), record, notable };
}

interface RuleOpts {
  source: ObservationSource;
  purpose: CheckinPurpose;
  countDistance: boolean;
  forced?: { event: 'enter' | 'leave'; zoneId: string };
  forcedCheckpoint?: string;
}

interface LeftZone {
  id: string;
  since: string;
  /** End of the stay (leave transition time or last observation inside). */
  end: number;
  durationMs: number;
}

/** Evaluate all location rules for an accepted observation at time `at`. */
function runRules(config: LockationConfig, state: LockationState, fix: Fix | undefined, at: Date, ctx: EvalContext, plan: Planner, record: CheckinRecord, o: RuleOpts) {
  const rctx: EvalContext = { ...ctx, now: at };
  const zones = zonesById(config);
  const inside = new Set(fix ? config.zones.filter((z) => isInside(fix, z, matchModeOf(config, z))).map((z) => z.id) : []);
  if (o.forced?.event === 'enter') inside.add(o.forced.zoneId);
  if (o.forced?.event === 'leave') inside.delete(o.forced.zoneId);
  record.zones = config.zones.filter((z) => inside.has(z.id)).map((z) => z.name);

  const left = updatePresence(config, state, fix, inside, at, o.forced);

  evalHunt(config, state, fix, rctx, plan, o.source === 'manual' ? o.purpose : 'general', o.forcedCheckpoint);
  if (o.source === 'manual' || config.tracking.countsAsCheckin || isLiveOnly(config)) evalRequired(config, state, inside, rctx, plan, o.source);
  if (fix || o.forced) evalStayWindows(config, state, inside, rctx, plan);
  evalForbidden(config, state, inside, left, zones, rctx, plan, o.source, ctx.now);
  evalReward(config, state, inside, left, zones, rctx, plan, o.source);
  if (fix && o.countDistance) evalTravel(config, state, fix, rctx, plan);
}

/**
 * F14 – presence with hysteresis. Entering needs `inside`; leaving needs the position to be
 * clearly outside (distance − accuracy > radius) or an explicit leave transition.
 */
function updatePresence(config: LockationConfig, state: LockationState, fix: Fix | undefined, inside: Set<string>, at: Date, forced?: RuleOpts['forced']): LeftZone[] {
  const atIso = at.toISOString();
  for (const id of inside) {
    const p = state.presence[id];
    if (p) p.lastSeen = atIso;
    else state.presence[id] = { since: atIso, lastSeen: atIso };
  }
  const left: LeftZone[] = [];
  for (const [id, p] of Object.entries(state.presence)) {
    if (inside.has(id)) continue;
    const zone = config.zones.find((z) => z.id === id);
    const forcedLeave = forced?.event === 'leave' && forced.zoneId === id;
    let out: boolean;
    if (!zone || forcedLeave) out = true;
    else if (!fix) out = false;
    else out = haversineM(fix, zone) - fix.accuracy > zone.radiusM;
    if (!out) continue;
    // A transition tells us the exact leave time; otherwise only the last observation inside is certain.
    const end = forcedLeave ? at.getTime() : Date.parse(p.lastSeen);
    left.push({ id, since: p.since, end, durationMs: Math.max(0, end - Date.parse(p.since)) });
    delete state.presence[id];
  }
  return left;
}

function finalizeRecord(record: CheckinRecord, list: PlannedConsequence[]) {
  record.consequences = list.map((p) => ({
    type: p.consequence.type,
    source: p.source,
    description: describeConsequence(p.consequence),
  }));
}

// ---------- F6 hunt ----------

/** Checkpoints the wearer may see (and that may be synced to OwnTracks), with their status. */
export function visibleCheckpoints(config: LockationConfig, state: LockationState): { cp: Checkpoint; index: number; status: 'found' | 'current' | 'open' | 'upcoming' }[] {
  const h = config.rules.hunt;
  if (!h.enabled) return [];
  const found = new Set(state.hunt.found);
  const all = h.checkpoints.map((cp, index) => {
    let status: 'found' | 'current' | 'open' | 'upcoming';
    if (h.order === 'any') status = found.has(cp.id) ? 'found' : 'open';
    else status = index < state.hunt.index ? 'found' : index === state.hunt.index ? 'current' : 'upcoming';
    return { cp, index, status };
  });
  if (h.reveal === 'all') return all;
  if (state.hunt.status !== 'active') return [];
  if (h.order === 'any') return all.filter((c) => c.status === 'open');
  return all.filter((c) => c.status === 'current');
}

function evalHunt(config: LockationConfig, state: LockationState, fix: Fix | undefined, ctx: EvalContext, plan: Planner, purpose: CheckinPurpose, forcedCheckpoint?: string) {
  const hunt = config.rules.hunt;
  if (!hunt.enabled || state.hunt.status !== 'active') return;
  const isIn = (cp: Checkpoint) => cp.id === forcedCheckpoint || (!!fix && isInside(fix, cp, matchModeOf(config, cp)));
  const total = hunt.checkpoints.length;
  const complete = () => {
    state.hunt.status = 'completed';
    plan.event(`Scavenger hunt completed – all ${total} checkpoints found!`);
    plan.add('hunt.onComplete', hunt.onComplete);
    plan.notify({ audience: 'keyholder', kind: 'hunt', title: 'Lockation: hunt completed', message: `All ${total} checkpoints found.`, key: 'hunt:completed' });
  };
  const found = (cp: Checkpoint, n: number) => {
    plan.add('hunt.onCheckpoint', hunt.onCheckpoint, 1, `:cp:${cp.id}`);
    plan.notify({ audience: 'keyholder', kind: 'hunt', title: 'Lockation: checkpoint found', message: `Checkpoint ${n}/${total} "${cp.name}" found.`, key: `hunt:${cp.id}` });
  };

  if (hunt.order === 'any') {
    const done = new Set(state.hunt.found);
    const hits = hunt.checkpoints.filter((cp) => !done.has(cp.id) && isIn(cp));
    for (const cp of hits) {
      state.hunt.found.push(cp.id);
      found(cp, state.hunt.found.length);
    }
    state.hunt.index = state.hunt.found.length;
    if (hits.length) {
      state.hunt.lastDistanceBand = undefined;
      if (state.hunt.found.length >= total) complete();
      else plan.event(`Checkpoint${hits.length > 1 ? 's' : ''} ${hits.map((c) => `"${c.name}"`).join(', ')} found (${state.hunt.found.length}/${total}).`);
      return;
    }
  } else {
    const target = hunt.checkpoints[state.hunt.index];
    if (!target) return;
    if (isIn(target)) {
      state.hunt.index += 1;
      state.hunt.lastDistanceBand = undefined;
      found(target, state.hunt.index);
      if (state.hunt.index >= total) complete();
      else plan.event(`Checkpoint ${state.hunt.index}/${total} found! Next hint unlocked.`);
      return;
    }
  }

  // Wrong guesses: only an explicit manual hunt guess, never with all targets visible.
  if (purpose !== 'hunt' || hunt.reveal === 'all' || !fix) return;
  const open = hunt.order === 'any' ? hunt.checkpoints.filter((c) => !state.hunt.found.includes(c.id)) : [hunt.checkpoints[state.hunt.index]!];
  const nearest = Math.min(...open.map((c) => haversineM(fix, c)));
  const band = distanceBand(nearest);
  state.hunt.lastDistanceBand = band;
  const coolingDown = msSince(state.hunt.lastWrongAt, ctx.now) < hunt.wrongCooldownMinutes * MINUTE;
  if (!coolingDown) {
    state.hunt.lastWrongAt = ctx.now.toISOString();
    plan.add('hunt.onWrong', hunt.onWrong);
    plan.event(hunt.reveal === 'hint' ? 'Wrong place for the next checkpoint.' : `Wrong place – the checkpoint is ${band} away.`);
  } else {
    plan.event(hunt.reveal === 'hint' ? 'Still not the right place.' : `Still not there – ${band} away.`);
  }
}

// ---------- F2 required ----------

function slotValid(slot: RequiredSlot, inside: Set<string>): boolean {
  return slot.zoneIds === null || slot.zoneIds.some((id) => inside.has(id));
}

function evalRequired(config: LockationConfig, state: LockationState, inside: Set<string>, ctx: EvalContext, plan: Planner, source: ObservationSource) {
  const r = config.rules.required;
  if (!r.enabled) return;
  const slots = requiredSlots(config);
  if (!slots.length) return;
  const done: string[] = [];
  for (const slot of slots) {
    const s = state.required.slots[slot.key];
    if (!s || !slotValid(slot, inside)) continue;
    // Background updates only reset the deadline; onSuccess consequences would fire far too often –
    // except for the first valid background update after a missed deadline (e.g. "unfreeze when back").
    const recovered = source === 'tracked' && !!s.missedSinceValid;
    s.lastValidAt = ctx.now.toISOString();
    s.nextDeadline = computeDeadline(config, ctx.now, slot).toISOString();
    s.missedSinceValid = undefined;
    if (recovered) {
      plan.add('required.onSuccess', slot.onSuccess, 1, `:req:${slot.key}`);
      plan.event(slot.zoneIds ? `Back in "${slot.name}" – check-in counted.` : 'Location received – check-in counted.');
    } else if (source === 'manual') {
      plan.add('required.onSuccess', slot.onSuccess, 1, `:req:${slot.key}`);
      done.push(slot.name);
    }
  }
  if (source !== 'manual') return;
  if (done.length) {
    plan.event(`Required check-in done (${done.join(', ')}).`);
    plan.notify({ audience: 'keyholder', kind: 'requiredDone', title: 'Lockation: check-in done', message: `Required check-in done (${done.join(', ')}).`, key: `required:done:${ctx.evalId}` });
  }
  const zoneSlots = slots.filter((s) => s.zoneIds !== null);
  if (zoneSlots.length && !zoneSlots.some((s) => slotValid(s, inside))) {
    plan.add('required.onOutside', r.onOutside);
    plan.event(`Not inside a required zone (${zoneSlots.map((s) => s.name).join(', ')}).`);
  }
}

/** Former curfew: during an active "must stay inside" window, being outside all such zones is penalised (cooldown). */
function evalStayWindows(config: LockationConfig, state: LockationState, inside: Set<string>, ctx: EvalContext, plan: Planner) {
  const r = config.rules.required;
  if (!r.enabled) return;
  const active = zonesWithRole(config, 'required').filter((z) => z.required.stayWindows.length && activeWindowStart(z.required.stayWindows, ctx.now, config.timezone));
  if (!active.length) return;
  // Hysteresis: a zone the wearer is still "present" in counts as inside.
  if (active.some((z) => inside.has(z.id) || state.presence[z.id])) return;
  if (msSince(state.required.windowLastTriggered, ctx.now) < r.windowCooldownMinutes * MINUTE) return;
  state.required.windowLastTriggered = ctx.now.toISOString();
  plan.add('required.onOutsideDuringWindow', [...r.onOutsideDuringWindow, ...active.flatMap((z) => z.required.onOutsideDuringWindow)], 1, ':window');
  plan.event(`Outside ${active.map((z) => `"${z.name}"`).join(' / ')} during a "must stay inside" window!`);
}

// ---------- F3 forbidden (escalation timeline) ----------

const FORBIDDEN_MAX_STEPS = 24;

function forbiddenWindowStart(config: LockationConfig, z: Zone, at: Date): Date | undefined | 'always' {
  if (!z.forbidden.windows.length) return 'always';
  return activeWindowStart(z.forbidden.windows, at, config.timezone);
}

function penaltyDue(visit: VisitState, n: number, firstPenalty: number, repeatEvery: number): number {
  return Date.parse(visit.since) + (firstPenalty + (n - 1) * repeatEvery) * MINUTE;
}

/**
 * Apply all penalties of a visit that are due up to `upTo`, and the warning of the current step if it is due and the
 * next penalty is still ahead. Warnings are only sent when `upTo` is the real "now" (`allowWarn`).
 */
function advanceVisit(config: LockationConfig, z: Zone, visit: VisitState, upTo: number, plan: Planner, allowWarn: boolean) {
  const T = forbiddenTimings(config, z);
  const rule = config.rules.forbidden;
  let steps = 0;
  while (steps < FORBIDDEN_MAX_STEPS) {
    const n = visit.penalties + 1;
    const due = penaltyDue(visit, n, T.firstPenalty, T.repeatEvery);
    if (due > upTo) break;
    const consequences = [...rule.onEnter, ...z.forbidden.onEnter].filter((c) => appliesAt(c, n));
    plan.addStable('forbidden.onEnter', consequences, `forbidden:${z.id}:${visit.since}:${n}`);
    const mins = Math.round((due - Date.parse(visit.since)) / MINUTE);
    plan.event(`Inside forbidden zone "${z.name}" for ${mins} min – penalty ${n}${consequences.length ? `: ${list(consequences)}` : ''}.`);
    if (n === 1 && T.firstWarning === null) {
      plan.notify({ audience: 'keyholder', kind: 'forbiddenEntered', title: 'Lockation: forbidden zone', message: `The wearer is in the forbidden zone "${z.name}".`, key: `forbidden:${z.id}:${visit.since}:entered`, zoneId: z.id });
    }
    visit.penalties = n;
    visit.lastPenaltyAt = new Date(due).toISOString();
    steps += 1;
  }
  if (!allowWarn) return;
  const step = visit.penalties;
  if (visit.warnedStep >= step) return;
  const offset = step === 0 ? T.firstWarning : T.repeatWarning;
  if (offset === null) return;
  const base = step === 0 ? Date.parse(visit.since) : Date.parse(visit.lastPenaltyAt!);
  const warnAt = base + offset * MINUTE;
  const next = penaltyDue(visit, step + 1, T.firstPenalty, T.repeatEvery);
  if (upTo < warnAt || upTo >= next) return;
  visit.warnedStep = step;
  const left = Math.max(1, Math.round((next - upTo) / MINUTE));
  const consequences = [...rule.onEnter, ...z.forbidden.onEnter].filter((c) => appliesAt(c, step + 1));
  const what = consequences.length ? list(consequences) : 'a penalty';
  plan.notify({
    audience: 'wearer',
    title: step === 0 ? `Forbidden zone "${z.name}"` : `Still inside "${z.name}"`,
    message: step === 0 ? `You are in the forbidden zone "${z.name}" – leave within ${left} min or: ${what}.` : `Still inside "${z.name}" – next penalty in ${left} min: ${what}.`,
    priority: 'high',
    key: `forbidden:${z.id}:${visit.since}:warn:${step}`,
    zoneId: z.id,
  });
  plan.event(step === 0 ? `Warning: inside forbidden zone "${z.name}" – penalty in ${left} min.` : `Warning: still inside "${z.name}" – next penalty in ${left} min.`);
  if (step === 0) {
    plan.notify({ audience: 'keyholder', kind: 'forbiddenEntered', title: 'Lockation: forbidden zone', message: `The wearer entered the forbidden zone "${z.name}".`, key: `forbidden:${z.id}:${visit.since}:entered`, zoneId: z.id });
  }
}

function evalForbidden(config: LockationConfig, state: LockationState, inside: Set<string>, left: LeftZone[], zones: Map<string, Zone>, ctx: EvalContext, plan: Planner, source: ObservationSource, realNow: Date) {
  const f = config.rules.forbidden;
  if (!f.enabled) return;
  const at = ctx.now.getTime();
  const tracking = config.tracking.enabled;
  for (const z of zonesWithRole(config, 'forbidden')) {
    const T = forbiddenTimings(config, z);
    const ws = forbiddenWindowStart(config, z, ctx.now);
    let visit = state.forbidden.visits[z.id];
    if (ws === undefined) {
      // Not forbidden right now (outside its windows): an ongoing visit ends without further penalties.
      if (visit) delete state.forbidden.visits[z.id];
      continue;
    }
    const windowStart = ws === 'always' ? undefined : ws.getTime();

    if (!tracking) {
      // Manual check-ins only: immediate penalty, repeated at most every `repeatEvery`.
      if (source !== 'manual') continue;
      if (inside.has(z.id)) {
        if (!visit) visit = state.forbidden.visits[z.id] = { since: ctx.now.toISOString(), lastInside: ctx.now.toISOString(), penalties: 0, warnedStep: -1 };
        visit.leftAt = undefined;
        visit.lastInside = ctx.now.toISOString();
        if (visit.lastPenaltyAt && at - Date.parse(visit.lastPenaltyAt) < T.repeatEvery * MINUTE) {
          plan.event(`Inside forbidden zone "${z.name}" (already penalised recently).`);
          continue;
        }
        const n = visit.penalties + 1;
        const consequences = [...f.onEnter, ...z.forbidden.onEnter].filter((c) => appliesAt(c, n));
        plan.addStable('forbidden.onEnter', consequences, `forbidden:${z.id}:${visit.since}:${n}`);
        visit.penalties = n;
        visit.lastPenaltyAt = ctx.now.toISOString();
        plan.event(`Inside forbidden zone "${z.name}"!`);
        plan.notify({ audience: 'keyholder', kind: 'forbiddenEntered', title: 'Lockation: forbidden zone', message: `The wearer checked in inside the forbidden zone "${z.name}".`, key: `forbidden:${z.id}:${visit.since}:entered:${n}`, zoneId: z.id });
      } else if (visit) {
        visit.leftAt ??= ctx.now.toISOString();
        if (at - Date.parse(visit.leftAt) >= T.repeatEvery * MINUTE) delete state.forbidden.visits[z.id];
      }
      continue;
    }

    // With background tracking: escalation timeline based on presence.
    const p = state.presence[z.id];
    const l = left.find((x) => x.id === z.id);
    if (p) {
      if (visit?.leftAt && at - Date.parse(visit.leftAt) >= T.repeatEvery * MINUTE) visit = undefined; // long gone → new visit
      if (!visit) {
        let since = Date.parse(p.since);
        if (windowStart !== undefined) since = Math.max(since, windowStart);
        visit = state.forbidden.visits[z.id] = { since: new Date(since).toISOString(), lastInside: ctx.now.toISOString(), penalties: 0, warnedStep: -1 };
      }
      visit.leftAt = undefined;
      visit.lastInside = ctx.now.toISOString();
      advanceVisit(config, z, visit, at, plan, at >= realNow.getTime() - MINUTE);
    } else if (visit && !visit.leftAt) {
      const end = l ? l.end : Date.parse(visit.lastInside);
      advanceVisit(config, z, visit, end, plan, false);
      visit.leftAt = new Date(end).toISOString();
      plan.event(`Left forbidden zone "${z.name}"${visit.penalties ? ` after ${visit.penalties} penalt${visit.penalties === 1 ? 'y' : 'ies'}` : ''}.`);
    }
    if (visit?.leftAt && at - Date.parse(visit.leftAt) >= T.repeatEvery * MINUTE) delete state.forbidden.visits[z.id];
  }
  void zones;
}

/** Cron part of the forbidden timeline: keep escalating while the wearer is (still believed to be) inside. */
function tickForbidden(config: LockationConfig, state: LockationState, now: Date, plan: Planner) {
  if (!config.rules.forbidden.enabled || !config.tracking.enabled) return;
  const fresh = config.tracking.heartbeatMinutes * MINUTE;
  for (const z of zonesWithRole(config, 'forbidden')) {
    const visit = state.forbidden.visits[z.id];
    if (!visit) continue;
    const T = forbiddenTimings(config, z);
    if (visit.leftAt) {
      if (now.getTime() - Date.parse(visit.leftAt) >= T.repeatEvery * MINUTE) delete state.forbidden.visits[z.id];
      continue;
    }
    if (forbiddenWindowStart(config, z, now) === undefined) {
      delete state.forbidden.visits[z.id];
      continue;
    }
    const p = state.presence[z.id];
    if (!p) continue;
    // "Still inside" is assumed only while the last location inside is fresh; afterwards the missing-signal rule applies.
    const limit = Math.min(now.getTime(), Date.parse(p.lastSeen) + fresh);
    advanceVisit(config, z, visit, limit, plan, limit === now.getTime());
  }
}

// ---------- F4 reward ----------
function evalReward(config: LockationConfig, state: LockationState, inside: Set<string>, left: LeftZone[], zones: Map<string, Zone>, ctx: EvalContext, plan: Planner, source: ObservationSource) {
  const r = config.rules.reward;
  if (!r.enabled) return;
  const today = dayKey(ctx.now, config.timezone);
  if (state.reward.day !== today) {
    state.reward.day = today;
    state.reward.countToday = 0;
    state.reward.countByZone = {};
  }
  for (const z of zonesWithRole(config, 'reward')) {
    const id = z.id;
    const name = z.name;
    const dwell = (z.reward.dwellMinutes ?? r.dwellMinutes) * MINUTE;
    const cooldown = (z.reward.cooldownMinutes ?? r.cooldownMinutes) * MINUTE;
    const zoneCap = z.reward.maxPerDay ?? r.maxPerDay;
    const p = state.presence[id];
    const l = left.find((x) => x.id === id);
    const isIn = inside.has(id) && !!p;
    if (!isIn && !(l && dwell > 0)) continue;
    const since = isIn ? p!.since : l!.since;
    const duration = isIn ? ctx.now.getTime() - Date.parse(p!.since) : l!.durationMs;
    if (dwell > 0) {
      if (state.reward.lastTriggered[id] && state.reward.lastTriggered[id]! >= since) continue; // already rewarded this visit
      if (duration < dwell) {
        if (isIn && source === 'manual') plan.event(`Reward zone "${name}": stay ${Math.ceil((dwell - duration) / MINUTE)} more min to earn the reward.`);
        continue;
      }
    }
    if (state.reward.countToday >= r.maxPerDay || (state.reward.countByZone[id] ?? 0) >= zoneCap) {
      if (source === 'manual') plan.event(`Reward zone "${name}": daily limit reached.`);
      continue;
    }
    if (msSince(state.reward.lastTriggered[id], ctx.now) < cooldown) {
      if (source === 'manual') plan.event(`Reward zone "${name}": still cooling down.`);
      continue;
    }
    state.reward.lastTriggered[id] = ctx.now.toISOString();
    state.reward.countToday += 1;
    state.reward.countByZone[id] = (state.reward.countByZone[id] ?? 0) + 1;
    const consequences = [...r.onEnter, ...z.reward.onEnter];
    plan.add('reward.onEnter', consequences, 1, `:r:${id}`);
    plan.event(`Reward zone "${name}" reached!`);
    plan.notify({ audience: 'keyholder', kind: 'reward', title: 'Lockation: reward earned', message: `Reward zone "${name}": ${list(consequences)}.`, key: `reward:${id}:${ctx.now.toISOString()}`, zoneId: id });
  }
  void zones;
}

// ---------- F5 travel ----------
function evalTravel(config: LockationConfig, state: LockationState, fix: Fix, ctx: EvalContext, plan: Planner) {
  const t = config.rules.travel;
  if (!t.enabled || !state.lastAccepted) return;
  const today = dayKey(ctx.now, config.timezone);
  if (state.travel.day !== today) {
    state.travel.day = today;
    state.travel.kmToday = 0;
  }
  let km = haversineM(state.lastAccepted, fix) / 1000;
  km = Math.min(km, t.maxKmPerCheckin, Math.max(0, t.dailyCapKm - state.travel.kmToday));
  if (km <= 0) return;
  state.travel.kmToday += km;
  state.travel.totalKm += km;
  state.travel.pendingKm += km;
  const steps = Math.floor(state.travel.pendingKm / t.stepKm + 1e-9);
  state.travel.pendingKm = Math.max(0, state.travel.pendingKm - steps * t.stepKm);
  plan.event(`Travelled ${km.toFixed(2)} km (total ${state.travel.totalKm.toFixed(2)} km).`);
  if (steps > 0) {
    plan.add('travel.onStep', t.onStep, steps);
    plan.event(`${steps} travel goal${steps > 1 ? 's' : ''} of ${t.stepKm} km reached.`);
  }
}

/** Track timed freezes so the tick can unfreeze them. */
function trackFreeze(state: LockationState, list: PlannedConsequence[], now: Date) {
  for (const p of list) {
    const c = p.consequence;
    if (c.type === 'freeze' && c.durationMinutes) {
      const until = now.getTime() + c.durationMinutes * MINUTE;
      if (!state.freezeUntil || Date.parse(state.freezeUntil) < until) state.freezeUntil = new Date(until).toISOString();
    } else if (c.type === 'unfreeze') {
      state.freezeUntil = undefined;
    }
  }
}

// ---------- heartbeat helpers ----------

export const MAX_MISSED_PER_TICK = 10;

/** Cron evaluation: deadlines, warnings, heartbeat, forbidden escalation, timed freezes, hunt timeout, random verification. */
export function evaluateTick(config: LockationConfig, prevState: LockationState, ctx: EvalContext): EvalResult {
  const state = cloneState(prevState);
  const plan = new Planner(ctx);
  const now = ctx.now;
  syncSlots(config, state, now);

  // F2 required: warnings before deadlines, then missed deadlines (per slot)
  const r = config.rules.required;
  for (const slot of requiredSlots(config)) {
    const s = state.required.slots[slot.key];
    if (!s?.nextDeadline) continue;
    const dl = Date.parse(s.nextDeadline);
    if (r.warnBeforeMinutes && now.getTime() >= dl - r.warnBeforeMinutes * MINUTE && now.getTime() < dl && s.warnedFor !== s.nextDeadline) {
      s.warnedFor = s.nextDeadline;
      const left = Math.max(1, Math.round((dl - now.getTime()) / MINUTE));
      plan.notify({
        audience: 'wearer',
        title: 'Check-in due soon',
        message: `Required check-in ${slot.zoneIds ? `at "${slot.name}"` : ''} due in ${left} min (${formatLocalTime(new Date(dl), config.timezone)}). Missed: ${list(slot.onMissed)}.`.replace('  ', ' '),
        priority: 'high',
        key: `required:${slot.key}:warn:${s.nextDeadline}`,
      });
      plan.event(`Warning: required check-in${slot.zoneIds ? ` at "${slot.name}"` : ''} due in ${left} min.`);
    }
    let n = 0;
    while (n < MAX_MISSED_PER_TICK) {
      const deadline: Date = new Date(s.nextDeadline!);
      if (now.getTime() < deadline.getTime() + slot.graceMinutes * MINUTE) break;
      // Key on slot + deadline → idempotent across retried ticks.
      s.missedCount += 1;
      plan.addStable('required.onMissed', slot.onMissed.filter((c) => appliesAt(c, s.missedCount)), `missed:${slot.key}:${deadline.toISOString()}`);
      s.missedSinceValid = true;
      plan.event(`Required check-in${slot.zoneIds ? ` at "${slot.name}"` : ''} missed (due ${formatLocalTime(deadline, config.timezone)}).`);
      plan.notify({ audience: 'keyholder', kind: 'requiredMissed', title: 'Lockation: check-in missed', message: `Required check-in${slot.zoneIds ? ` at "${slot.name}"` : ''} missed.`, key: `missed:${slot.key}:${deadline.toISOString()}` });
      s.nextDeadline = computeDeadline(config, deadline, slot).toISOString();
      n += 1;
    }
  }

  // F14 heartbeat (with quiet hours and warning)
  const tr = config.tracking;
  if (tr.enabled) {
    const hb = tr.heartbeatMinutes * MINUTE;
    if (!state.tracking.nextHeartbeat) state.tracking.nextHeartbeat = nextHeartbeatFrom(config, now).toISOString();
    let due = new Date(state.tracking.nextHeartbeat);
    if (tr.quietHours && isInQuietHours(due, tr.quietHours, config.timezone)) {
      due = new Date(adjustForQuietHours(due, tr.quietHours, config.timezone).getTime() + hb);
      state.tracking.nextHeartbeat = due.toISOString();
    }
    const quietNow = !!tr.quietHours && isInQuietHours(now, tr.quietHours, config.timezone);
    if (tr.warnBeforeMinutes && !quietNow && now.getTime() >= due.getTime() - tr.warnBeforeMinutes * MINUTE && now.getTime() < due.getTime() && state.tracking.warnedFor !== state.tracking.nextHeartbeat) {
      state.tracking.warnedFor = state.tracking.nextHeartbeat;
      const left = Math.max(1, Math.round((due.getTime() - now.getTime()) / MINUTE));
      plan.notify({
        audience: 'wearer',
        title: 'No location from your phone',
        message: `${state.tracking.lastSeenAt ? `No location since ${formatLocalTime(new Date(state.tracking.lastSeenAt), config.timezone)}` : 'Background tracking is not set up'} – open OwnTracks, otherwise in ${left} min: ${list(tr.onHeartbeatMissed)}.`,
        priority: 'high',
        key: `heartbeat:warn:${state.tracking.nextHeartbeat}`,
      });
      plan.event(`Warning: no location from the phone – missing-signal penalty in ${left} min.`);
    }
    let n = 0;
    while (n < MAX_MISSED_PER_TICK) {
      due = new Date(state.tracking.nextHeartbeat!);
      if (now.getTime() < due.getTime()) break;
      state.tracking.missedCount += 1;
      plan.addStable('tracking.onHeartbeatMissed', tr.onHeartbeatMissed.filter((c) => appliesAt(c, state.tracking.missedCount)), `heartbeat:${due.toISOString()}`);
      const msg = state.tracking.lastSeenAt ? `No background location received since ${formatLocalTime(new Date(state.tracking.lastSeenAt), config.timezone)}.` : 'Background tracking has not been set up.';
      plan.event(msg);
      plan.notify({ audience: 'keyholder', kind: 'tracking', title: 'Lockation: no signal', message: msg, key: `heartbeat:${due.toISOString()}` });
      let next = new Date(due.getTime() + hb);
      if (tr.quietHours && isInQuietHours(next, tr.quietHours, config.timezone)) next = new Date(adjustForQuietHours(next, tr.quietHours, config.timezone).getTime() + hb);
      state.tracking.nextHeartbeat = next.toISOString();
      n += 1;
    }
  }

  // F3 forbidden escalation while inside
  tickForbidden(config, state, now, plan);

  // Timed freeze
  if (state.freezeUntil && now.getTime() >= Date.parse(state.freezeUntil)) {
    plan.addStable('freeze.expired', [{ type: 'unfreeze' }], `unfreeze:${state.freezeUntil}`);
    plan.event('Timed freeze ended.');
    state.freezeUntil = undefined;
  }

  // F6 hunt timeout
  const h = config.rules.hunt;
  if (h.enabled && h.timeLimitMinutes && state.hunt.status === 'active') {
    const start = Date.parse(state.hunt.startedAt ?? state.startedAt);
    if (now.getTime() >= start + h.timeLimitMinutes * MINUTE) {
      state.hunt.status = 'failed';
      plan.addStable('hunt.onTimeout', h.onTimeout, 'hunt-timeout');
      plan.event('Scavenger hunt time limit exceeded.');
      plan.notify({ audience: 'keyholder', kind: 'hunt', title: 'Lockation: hunt failed', message: 'The scavenger hunt time limit was exceeded.', key: 'hunt:failed' });
    }
  }

  // Live-only: random verification pictures
  const every = config.antiCheat.liveVerificationEveryHours;
  if (isLiveOnly(config) && every) {
    const rng = ctx.rng ?? Math.random;
    const schedule = (from: number) => new Date(from + every * 60 * MINUTE * (0.5 + rng())).toISOString();
    if (!state.nextLiveVerification) state.nextLiveVerification = schedule(now.getTime());
    else if (now.getTime() >= Date.parse(state.nextLiveVerification)) {
      plan.addStable('antiCheat.verification', [{ type: 'verification_picture' }], `live-vp:${state.nextLiveVerification}`);
      plan.event('Random verification picture requested.');
      state.nextLiveVerification = schedule(now.getTime());
    }
  }

  trackFreeze(state, plan.list.filter((p) => p.source !== 'freeze.expired'), now);
  return { state, consequences: plan.list, events: plan.events, notices: plan.finish() };
}

/** Whether the tick would do anything (used by the worker to skip writes). */
export function tickIsNoop(result: EvalResult): boolean {
  return result.consequences.length === 0 && result.events.length === 0 && result.notices.length === 0;
}

/**
 * Next instant at which a tick has something to do (penalty, warning, unfreeze, …), or undefined.
 * The worker indexes sessions by this time so the 1-minute cron only touches sessions that are due.
 */
export function nextDueAt(config: LockationConfig, state: LockationState, now: Date): Date | undefined {
  const times: number[] = [];
  const push = (t: number | undefined) => {
    if (t !== undefined && Number.isFinite(t)) times.push(t);
  };
  const r = config.rules.required;
  for (const slot of requiredSlots(config)) {
    const s = state.required.slots[slot.key];
    if (!s?.nextDeadline) continue;
    const dl = Date.parse(s.nextDeadline);
    push(dl + slot.graceMinutes * MINUTE);
    if (r.warnBeforeMinutes && s.warnedFor !== s.nextDeadline) push(dl - r.warnBeforeMinutes * MINUTE);
  }
  const tr = config.tracking;
  if (tr.enabled && state.tracking.nextHeartbeat) {
    const due = Date.parse(state.tracking.nextHeartbeat);
    push(due);
    if (tr.warnBeforeMinutes && state.tracking.warnedFor !== state.tracking.nextHeartbeat) push(due - tr.warnBeforeMinutes * MINUTE);
  }
  if (config.rules.forbidden.enabled && tr.enabled) {
    for (const z of zonesWithRole(config, 'forbidden')) {
      const v = state.forbidden.visits[z.id];
      if (!v) continue;
      const T = forbiddenTimings(config, z);
      if (v.leftAt) {
        push(Date.parse(v.leftAt) + T.repeatEvery * MINUTE);
        continue;
      }
      const next = penaltyDue(v, v.penalties + 1, T.firstPenalty, T.repeatEvery);
      push(next);
      const offset = v.penalties === 0 ? T.firstWarning : T.repeatWarning;
      if (offset !== null && v.warnedStep < v.penalties) {
        push((v.penalties === 0 ? Date.parse(v.since) : Date.parse(v.lastPenaltyAt!)) + offset * MINUTE);
      }
    }
  }
  if (state.freezeUntil) push(Date.parse(state.freezeUntil));
  const h = config.rules.hunt;
  if (h.enabled && h.timeLimitMinutes && state.hunt.status === 'active') push(Date.parse(state.hunt.startedAt ?? state.startedAt) + h.timeLimitMinutes * MINUTE);
  if (state.nextLiveVerification) push(Date.parse(state.nextLiveVerification));
  if (!times.length) return undefined;
  return new Date(Math.max(now.getTime(), Math.min(...times)));
}
