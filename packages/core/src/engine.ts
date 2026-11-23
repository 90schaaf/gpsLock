/**
 * The rule engine. Pure functions: (config, state, input, context) → result.
 * No I/O; the worker / demo backend apply the planned consequences.
 */
import type { LockationConfig, Zone } from './config.js';
import { type Consequence, describeConsequence, scaleConsequence } from './consequences.js';
import { distanceBand, haversineM, isInside, roundCoord } from './geo.js';
import { cloneState, computeDeadline, effectivePrivacy, type LockationState } from './state.js';
import { dayKey, isInQuietHours, MINUTE } from './time.js';

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
}

export interface CheckinResult extends EvalResult {
  record: CheckinRecord;
}

export interface TrackedInput {
  fix?: Fix;
  /** OwnTracks region transition. `zoneId` is resolved by the caller (may be undefined for unknown regions). */
  transition?: { event: 'enter' | 'leave'; zoneId?: string; at: number };
}

export interface TrackedResult extends CheckinResult {
  /** Whether this observation is worth recording in history / logs. */
  notable: boolean;
}

class Planner {
  readonly list: PlannedConsequence[] = [];
  readonly events: string[] = [];
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

  /** Add with an idempotency key that is stable across retries (cron). */
  addStable(source: string, consequences: Consequence[], stableKey: string) {
    consequences.forEach((c, i) => {
      this.list.push({ consequence: c, source, idempotencyKey: `${this.ctx.sessionId}:${stableKey}:${i}` });
    });
  }

  event(msg: string) {
    this.events.push(msg);
  }
}

const msSince = (iso: string | undefined, now: Date) => (iso ? now.getTime() - Date.parse(iso) : Infinity);

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
  state.checkinCount += 1;
  state.lastAttemptAt = now.toISOString();
  const record = newRecord(config, state, ctx.evalId, now, fix, purpose, plan.events);

  const reject = (reason: RejectReason, message: string): CheckinResult => {
    record.outcome = 'rejected';
    record.reason = reason;
    plan.event(message);
    finalizeRecord(record, plan.list);
    return { state, consequences: plan.list, events: plan.events, record };
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
  return { state, consequences: plan.list, events: plan.events, record };
}

/** F14 – evaluate a background observation (OwnTracks location or transition). */
export function evaluateTracked(config: LockationConfig, prevState: LockationState, input: TrackedInput, ctx: EvalContext): TrackedResult {
  const state = cloneState(prevState);
  const plan = new Planner(ctx);
  const now = ctx.now;
  const fix = input.fix;
  const at = new Date(Math.min(fix?.timestamp ?? input.transition?.at ?? now.getTime(), now.getTime()));

  // Every authenticated message proves the device is alive (heartbeat).
  state.tracking.lastSeenAt = now.toISOString();
  state.tracking.trackedCount += 1;
  if (config.tracking.enabled) {
    state.tracking.nextHeartbeat = new Date(now.getTime() + config.tracking.heartbeatMinutes * MINUTE).toISOString();
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
    return { state, consequences: plan.list, events: plan.events, record, notable: false };
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

  const forced = input.transition?.zoneId ? { event: input.transition.event, zoneId: input.transition.zoneId } : undefined;
  runRules(config, state, fix, at, ctx, plan, record, { source: 'tracked', purpose: 'general', countDistance: true, forced });
  if (fix) storeLastAccepted(config, state, fix, now);

  const presenceAfter = Object.keys(state.presence).sort().join(',');
  const notable = plan.list.length > 0 || presenceAfter !== presenceBefore || huntBefore !== `${state.hunt.index}:${state.hunt.status}`;
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
  return { state, consequences: plan.list, events: plan.events, record, notable };
}

interface RuleOpts {
  source: ObservationSource;
  purpose: CheckinPurpose;
  countDistance: boolean;
  forced?: { event: 'enter' | 'leave'; zoneId: string };
}

interface LeftZone {
  id: string;
  since: string;
  durationMs: number;
}

/** Evaluate all location rules for an accepted observation at time `at`. */
function runRules(config: LockationConfig, state: LockationState, fix: Fix | undefined, at: Date, ctx: EvalContext, plan: Planner, record: CheckinRecord, o: RuleOpts) {
  const rctx: EvalContext = { ...ctx, now: at };
  const zones = zonesById(config);
  const inside = new Set(fix ? config.zones.filter((z) => isInside(fix, z, config.matchMode)).map((z) => z.id) : []);
  if (o.forced?.event === 'enter') inside.add(o.forced.zoneId);
  if (o.forced?.event === 'leave') inside.delete(o.forced.zoneId);
  record.zones = config.zones.filter((z) => inside.has(z.id)).map((z) => z.name);

  const left = updatePresence(config, state, fix, inside, at, o.forced);

  if (fix) evalHunt(config, state, fix, rctx, plan, o.source === 'manual' ? o.purpose : 'general');
  if (o.source === 'manual' || config.tracking.countsAsCheckin || isLiveOnly(config)) evalRequired(config, state, inside, zones, rctx, plan, o.source);
  evalForbidden(config, state, inside, left, zones, rctx, plan, o.source);
  evalReward(config, state, inside, left, zones, rctx, plan, o.source);
  if (fix) evalCurfew(config, state, inside, rctx, plan);
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
    left.push({ id, since: p.since, durationMs: Math.max(0, end - Date.parse(p.since)) });
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
function evalHunt(config: LockationConfig, state: LockationState, fix: Fix, ctx: EvalContext, plan: Planner, purpose: CheckinPurpose) {
  const hunt = config.rules.hunt;
  if (!hunt.enabled || state.hunt.status !== 'active') return;
  const target = hunt.checkpoints[state.hunt.index];
  if (!target) return;
  if (isInside(fix, target, config.matchMode)) {
    state.hunt.index += 1;
    state.hunt.lastDistanceBand = undefined;
    plan.add('hunt.onCheckpoint', hunt.onCheckpoint);
    if (state.hunt.index >= hunt.checkpoints.length) {
      state.hunt.status = 'completed';
      plan.event(`Scavenger hunt completed – all ${hunt.checkpoints.length} checkpoints found!`);
      plan.add('hunt.onComplete', hunt.onComplete);
    } else {
      plan.event(`Checkpoint ${state.hunt.index}/${hunt.checkpoints.length} found! Next hint unlocked.`);
    }
    return;
  }
  if (purpose !== 'hunt') return;
  const band = distanceBand(haversineM(fix, target));
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
function evalRequired(config: LockationConfig, state: LockationState, inside: Set<string>, zones: Map<string, Zone>, ctx: EvalContext, plan: Planner, source: ObservationSource) {
  const r = config.rules.required;
  if (!r.enabled) return;
  const valid = r.zoneIds.length === 0 || r.zoneIds.some((id) => inside.has(id));
  if (valid) {
    // Background updates only reset the deadline; onSuccess consequences would fire far too often –
    // except for the first valid background update after a missed deadline (e.g. "unfreeze when back").
    const recovered = source === 'tracked' && !!state.required.missedSinceValid;
    state.required.lastValidAt = ctx.now.toISOString();
    state.required.nextDeadline = computeDeadline(config, ctx.now).toISOString();
    state.required.missedSinceValid = undefined;
    if (recovered) {
      plan.add('required.onSuccess', r.onSuccess);
      plan.event('Back in a required zone – check-in counted.');
    } else if (source === 'manual') {
      plan.add('required.onSuccess', r.onSuccess);
      plan.event(`Required check-in done${r.zoneIds.length ? ` (${r.zoneIds.filter((i) => inside.has(i)).map((i) => zones.get(i)?.name).join(', ')})` : ''}.`);
    }
  } else if (source === 'manual') {
    plan.add('required.onOutside', r.onOutside);
    plan.event(`Not inside a required zone (${r.zoneIds.map((i) => zones.get(i)?.name).join(', ')}).`);
  }
}

// ---------- F3 forbidden ----------
function evalForbidden(config: LockationConfig, state: LockationState, inside: Set<string>, left: LeftZone[], zones: Map<string, Zone>, ctx: EvalContext, plan: Planner, source: ObservationSource) {
  const f = config.rules.forbidden;
  if (!f.enabled) return;
  const confirm = config.tracking.entryConfirmMinutes * MINUTE;
  for (const id of f.zoneIds) {
    const name = zones.get(id)?.name ?? id;
    const p = state.presence[id];
    const l = left.find((x) => x.id === id);
    let trigger = false;
    if (source === 'manual' && inside.has(id)) trigger = true;
    else if (p && inside.has(id)) trigger = ctx.now.getTime() - Date.parse(p.since) >= confirm;
    else if (l) {
      const alreadyThisVisit = !!state.forbidden.lastTriggered[id] && state.forbidden.lastTriggered[id]! >= l.since;
      trigger = !alreadyThisVisit && l.durationMs >= confirm;
    }
    if (!trigger) continue;
    if (msSince(state.forbidden.lastTriggered[id], ctx.now) < f.cooldownMinutes * MINUTE) {
      if (source === 'manual') plan.event(`Inside forbidden zone "${name}" (already penalised recently).`);
      continue;
    }
    state.forbidden.lastTriggered[id] = ctx.now.toISOString();
    plan.add(`forbidden.onEnter`, f.onEnter, 1, `:f:${id}`);
    plan.event(l ? `Was inside forbidden zone "${name}" for ${Math.round(l.durationMs / MINUTE)} min!` : `Inside forbidden zone "${name}"!`);
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
  }
  const dwell = r.dwellMinutes * MINUTE;
  for (const id of r.zoneIds) {
    const name = zones.get(id)?.name ?? id;
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
    if (state.reward.countToday >= r.maxPerDay) {
      if (source === 'manual') plan.event(`Reward zone "${name}": daily limit reached.`);
      continue;
    }
    if (msSince(state.reward.lastTriggered[id], ctx.now) < r.cooldownMinutes * MINUTE) {
      if (source === 'manual') plan.event(`Reward zone "${name}": still cooling down.`);
      continue;
    }
    state.reward.lastTriggered[id] = ctx.now.toISOString();
    state.reward.countToday += 1;
    plan.add('reward.onEnter', r.onEnter, 1, `:r:${id}`);
    plan.event(`Reward zone "${name}" reached!`);
  }
}

// ---------- F15 curfew ----------
function evalCurfew(config: LockationConfig, state: LockationState, inside: Set<string>, ctx: EvalContext, plan: Planner) {
  const c = config.rules.curfew;
  if (!c.enabled || !c.zoneIds.length) return;
  if (!isInQuietHours(ctx.now, { start: c.start, end: c.end }, config.timezone)) return;
  // Hysteresis: a zone the wearer is still "present" in counts as inside.
  if (c.zoneIds.some((id) => inside.has(id) || state.presence[id])) return;
  if (msSince(state.curfew.lastTriggered, ctx.now) < c.cooldownMinutes * MINUTE) return;
  state.curfew.lastTriggered = ctx.now.toISOString();
  plan.add('curfew.onOutside', c.onOutside, 1, ':curfew');
  plan.event(`Outside the curfew zone during curfew (${c.start}–${c.end})!`);
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

export const MAX_MISSED_PER_TICK = 10;

/** Cron evaluation: deadlines, heartbeat, timed freezes, hunt timeout. */
export function evaluateTick(config: LockationConfig, prevState: LockationState, ctx: EvalContext): EvalResult {
  const state = cloneState(prevState);
  const plan = new Planner(ctx);
  const now = ctx.now;

  // F2 missed check-ins
  const r = config.rules.required;
  if (r.enabled) {
    if (!state.required.nextDeadline) {
      state.required.nextDeadline = computeDeadline(config, now).toISOString();
    }
    let n = 0;
    while (n < MAX_MISSED_PER_TICK) {
      const deadline: Date = new Date(state.required.nextDeadline!);
      if (now.getTime() < deadline.getTime() + r.graceMinutes * MINUTE) break;
      // Key on the deadline itself → idempotent across retried ticks.
      plan.addStable('required.onMissed', r.onMissed, `missed:${deadline.toISOString()}`);
      state.required.missedCount += 1;
      state.required.missedSinceValid = true;
      plan.event(`Required check-in missed (due ${deadline.toISOString()}).`);
      state.required.nextDeadline = computeDeadline(config, deadline).toISOString();
      n += 1;
    }
  }

  // F14 heartbeat
  const tr = config.tracking;
  if (tr.enabled) {
    const hb = tr.heartbeatMinutes * MINUTE;
    if (!state.tracking.nextHeartbeat) state.tracking.nextHeartbeat = new Date(now.getTime() + hb).toISOString();
    let n = 0;
    while (n < MAX_MISSED_PER_TICK) {
      const due: Date = new Date(state.tracking.nextHeartbeat!);
      if (now.getTime() < due.getTime()) break;
      plan.addStable('tracking.onHeartbeatMissed', tr.onHeartbeatMissed, `heartbeat:${due.toISOString()}`);
      state.tracking.missedCount += 1;
      plan.event(
        state.tracking.lastSeenAt
          ? `No background location received since ${state.tracking.lastSeenAt}.`
          : 'Background tracking has not been set up.',
      );
      state.tracking.nextHeartbeat = new Date(due.getTime() + hb).toISOString();
      n += 1;
    }
  }

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
    }
  }

  trackFreeze(state, plan.list.filter((p) => p.source !== 'freeze.expired'), now);
  return { state, consequences: plan.list, events: plan.events };
}

/** Whether the tick would do anything (used by the worker to skip writes). */
export function tickIsNoop(result: EvalResult): boolean {
  return result.consequences.length === 0 && result.events.length === 0;
}
