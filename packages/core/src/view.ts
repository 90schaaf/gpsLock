/** View models sent to the browser, Chaster metadata (F12) and privacy helpers (F9). */
import { activeRoles, forbiddenTimings, type LockationConfig, owntracksMonitoring, type ZoneRole, zonesWithRole } from './config.js';
import { describeConsequence, describeWhen, type Consequence } from './consequences.js';
import { allowedHuntActions, type CheckinRecord, type HuntAction, huntDeadlineOf, huntRoute, huntScheduledStart, huntTotal, type PlannedConsequence, visibleCheckpoints } from './engine.js';
import { earliestDeadline, effectivePrivacy, type LockationState, nextHeartbeatFrom, requiredSlots } from './state.js';
import { activeWindowStart, formatLocalTime, formatWindow, MINUTE } from './time.js';

export type Role = 'wearer' | 'keyholder';

export interface ZoneView {
  id: string;
  name: string;
  lat: number;
  lng: number;
  radiusM: number;
  /** Roles of enabled rules. */
  kinds: ZoneRole[];
  /** Human readable time windows ("Stay inside 22:00–06:00", "Forbidden 20:00–02:00"). */
  windows: string[];
  /** A window of this zone is active right now. */
  windowActive: boolean;
  /** F17 – the keyholder confirmed this place is intentionally hard to reach. */
  reachabilityNote?: string;
}

export interface RuleSummary {
  rule: 'required' | 'forbidden' | 'reward' | 'travel' | 'hunt' | 'tracking' | 'zoneActions';
  title: string;
  lines: string[];
}

export interface RequiredSlotView {
  key: string;
  name: string;
  nextDeadline?: string;
  overdue: boolean;
  missedCount: number;
  lastValidAt?: string;
  graceMinutes: number;
}

export interface HuntCheckpointView {
  index: number;
  name: string;
  hint: string;
  lat: number;
  lng: number;
  radiusM: number;
  status: 'found' | 'current' | 'open' | 'upcoming';
}

export interface SessionView {
  role: Role;
  isSelfLock: boolean;
  timezone: string;
  privacy: 'zone_only' | 'exact';
  privacyLocked: boolean;
  matchMode: 'lenient' | 'strict';
  maxAccuracyM: number;
  /** F16 – manual check-ins are disabled; location only via live tracking. */
  liveOnly: boolean;
  zones: ZoneView[];
  rules: RuleSummary[];
  /** Earliest required deadline (summary); details per zone in `requiredSlots`. */
  required?: { nextDeadline?: string; overdue: boolean; missedCount: number; lastValidAt?: string; graceMinutes: number };
  requiredSlots?: RequiredSlotView[];
  hunt?: {
    status: 'not_started' | 'active' | 'paused' | 'completed' | 'failed' | 'aborted';
    /** Actions the current viewer may perform (start / pause / resume / abort). */
    actions: HuntAction[];
    /** How the hunt starts (wearer / keyholder / auto / scheduled) and the scheduled time. */
    start: 'auto' | 'wearer' | 'keyholder' | 'scheduled';
    scheduledStartAt?: string;
    pausedAt?: string;
    index: number;
    total: number;
    reveal: 'all' | 'hint' | 'distance' | 'map';
    order: 'sequence' | 'any';
    hint?: string;
    distanceBand?: string;
    target?: { lat: number; lng: number; radiusM: number };
    /** Random route: whether it is drawn yet, the range and the pool size (the wearer only learns the count after the draw). */
    randomRoute?: { drawn: boolean; min: number; max: number; pool: number };
    /** Visible checkpoints with status (reveal `all`: every checkpoint; `map`: the current/open ones). */
    checkpoints: HuntCheckpointView[];
    /** Hints of the open checkpoints (any-order mode with hint/distance reveal). */
    openHints?: string[];
    /** Whether the wearer may submit a hunt guess (disabled with reveal `all`). */
    guessesAllowed: boolean;
    /** Generic note when hidden checkpoints are in difficult terrain (F17). */
    terrainNote?: string;
    deadline?: string;
  };
  travel?: { totalKm: number; pendingKm: number; stepKm: number; kmToday: number; dailyCapKm: number };
  freezeUntil?: string;
  /** F14 – background tracking status. */
  tracking?: {
    paired: boolean;
    /**
     * Real connection state: `not_set_up` (no phone paired), `waiting` (paired, but no location received from this
     * pairing yet), `connected` (a location arrived within the missing-signal time), `no_signal` (last one is older).
     */
    status: TrackingStatus;
    pairedAt?: string;
    lastSeenAt?: string;
    nextHeartbeat?: string;
    overdue: boolean;
    missedCount: number;
    heartbeatMinutes: number;
    updates: number;
    /**
     * Latest time the next location must arrive (last location + missing-signal time, quiet hours respected).
     * After it the signal counts as delayed; `nextHeartbeat` is the next missing-signal penalty.
     */
    signalDueAt: string;
    /** OwnTracks mode the phone should use. */
    mode: 'move' | 'significant';
    /** Locations arrive from the current pairing, but the setup isn't confirmed by a manual send yet. */
    receiving: boolean;
  };
  /**
   * Last accepted position of the wearer. Always included for the wearer (rounded in zone-only mode);
   * for the keyholder only when exact coordinates are shared. Never for anyone else.
   */
  lastPosition?: { lat: number; lng: number; accuracy: number; at: string; approximate: boolean };
  /** Zones the wearer is currently known to be in (from check-ins and tracking). */
  presentZones: string[];
  /** Ongoing forbidden-zone stays with the next penalty time. */
  forbiddenVisits: { zone: string; since: string; penalties: number; nextPenaltyAt?: string }[];
  /** Configuration changed during the lock (shown to the wearer until acknowledged). */
  rulesChanged?: { at: string; summary: string[] };
  /** Whether ntfy notifications can be set up (worker has a token). Filled in by the backend. */
  notifications?: { available: boolean; subscribed: boolean };
  stats: { checkins: number; accepted: number; lastCheckinAt?: string };
  history: CheckinRecord[];
}

export type TrackingStatus = 'not_set_up' | 'waiting' | 'connected' | 'no_signal';

/** F14 – connection state derived from what the server actually received, not from the pairing alone. */
export function trackingStatus(state: LockationState, heartbeatMinutes: number, now: Date): TrackingStatus {
  const t = state.tracking;
  if (!t.deviceUser) return 'not_set_up';
  const seen = t.lastSeenAt ? Date.parse(t.lastSeenAt) : NaN;
  const paired = t.pairedAt ? Date.parse(t.pairedAt) : NaN;
  const verified = t.verifiedAt ? Date.parse(t.verifiedAt) : NaN;
  // Setup is complete only after the wearer sent a location manually (OwnTracks ↑) with the current pairing.
  if (!Number.isFinite(verified) || (Number.isFinite(paired) && verified < paired)) return 'waiting';
  if (!Number.isFinite(seen)) return 'waiting';
  return now.getTime() - seen <= heartbeatMinutes * MINUTE ? 'connected' : 'no_signal';
}

const list = (cs: Consequence[]) => (cs.length ? cs.map((c) => describeConsequence(c) + describeWhen(c.when)).join(', ') : 'nothing');

export function summarizeRules(config: LockationConfig): RuleSummary[] {
  const out: RuleSummary[] = [];
  const { required, forbidden, reward, travel, hunt } = config.rules;
  if (required.enabled) {
    const lines: string[] = [];
    if (required.anywhere) lines.push(`Check in anywhere at least every ${fmtMinutes(required.intervalMinutes)} (grace ${fmtMinutes(required.graceMinutes)}).`);
    const zones = zonesWithRole(config, 'required');
    const interval = zones.filter((z) => z.required.intervalCheckins);
    if (interval.length) {
      {
        for (const z of interval) {
          lines.push(
            `Check in inside ${z.name} at least every ${fmtMinutes(z.required.intervalMinutes ?? required.intervalMinutes)} (grace ${fmtMinutes(z.required.graceMinutes ?? required.graceMinutes)})${z.required.onMissed.length ? `; missed there additionally: ${list(z.required.onMissed)}` : ''}.`,
          );
        }
      }
    }
    for (const z of zones.filter((x) => x.required.stayWindows.length)) {
      lines.push(`Stay inside ${z.name} during ${z.required.stayWindows.map(formatWindow).join(', ')}.`);
    }
    if (zones.some((z) => z.required.stayWindows.length)) lines.push(`Outside during a stay window: ${list(required.onOutsideDuringWindow)} (at most every ${fmtMinutes(required.windowCooldownMinutes)}).`);
    if (required.quietHours) lines.push(`No check-ins required between ${required.quietHours.start} and ${required.quietHours.end}.`);
    if (required.anywhere || interval.length) lines.push(`Missed: ${list(required.onMissed)}.`);
    if (required.onOutside.length) lines.push(`Checked in outside the required zones: ${list(required.onOutside)}.`);
    if (required.onSuccess.length) lines.push(`Successful check-in: ${list(required.onSuccess)}.`);
    if (required.warnBeforeMinutes) lines.push(`You get a warning ${fmtMinutes(required.warnBeforeMinutes)} before a deadline (if notifications are set up).`);
    out.push({ rule: 'required', title: 'Required zones', lines });
  }
  if (forbidden.enabled) {
    const lines: string[] = [];
    for (const z of zonesWithRole(config, 'forbidden')) {
      const T = forbiddenTimings(config, z);
      const when = z.forbidden.windows.length ? ` during ${z.forbidden.windows.map(formatWindow).join(', ')}` : '';
      const timeline = config.tracking.enabled
        ? `${T.firstWarning !== null ? `warning after ${fmtMinutes(T.firstWarning)}, ` : ''}first penalty after ${fmtMinutes(T.firstPenalty)}, then every ${fmtMinutes(T.repeatEvery)}`
        : `penalty at each check-in inside (at most every ${fmtMinutes(T.repeatEvery)})`;
      lines.push(`${z.name}${when}: ${timeline}: ${list([...forbidden.onEnter, ...z.forbidden.onEnter])}.`);
    }
    out.push({ rule: 'forbidden', title: 'Forbidden zones', lines });
  }
  if (reward.enabled) {
    const lines = zonesWithRole(config, 'reward').map((z) => {
      const dwell = z.reward.dwellMinutes ?? reward.dwellMinutes;
      return `${z.name}: ${list([...reward.onEnter, ...z.reward.onEnter])} – at most ${z.reward.maxPerDay ?? reward.maxPerDay}× per day, cooldown ${fmtMinutes(z.reward.cooldownMinutes ?? reward.cooldownMinutes)}${dwell ? `, stay at least ${fmtMinutes(dwell)}` : ''}.`;
    });
    lines.push(`At most ${reward.maxPerDay} reward${reward.maxPerDay === 1 ? '' : 's'} per day in total.`);
    out.push({ rule: 'reward', title: 'Reward zones', lines });
  }
  if (travel.enabled) {
    out.push({
      rule: 'travel',
      title: 'Travel goals',
      lines: [
        `Every ${travel.stepKm} km travelled: ${list(travel.onStep)}.`,
        `Counted: at most ${travel.maxKmPerCheckin} km per check-in and ${travel.dailyCapKm} km per day.`,
      ],
    });
  }
  if (hunt.enabled) {
    out.push({
      rule: 'hunt',
      title: 'Scavenger hunt',
      lines: [
        `${hunt.random.enabled ? `Random route: ${hunt.random.min === hunt.random.max ? hunt.random.min : `${hunt.random.min}–${hunt.random.max}`} of ${hunt.checkpoints.length} possible checkpoints, drawn at the start` : `${hunt.checkpoints.length} checkpoints`}, ${hunt.order === 'any' ? 'in any order' : 'in a fixed order'}${hunt.reveal === 'all' ? ' – all shown on the map' : ''}.`,
        `Each checkpoint: ${list(hunt.onCheckpoint)}. Completed: ${list(hunt.onComplete)}.`,
        ...(hunt.reveal !== 'all' ? [`Wrong hunt guess: ${list(hunt.onWrong)}.`] : []),
        ...(hunt.timeLimitMinutes ? [`Time limit ${fmtMinutes(hunt.timeLimitMinutes)}: ${list(hunt.onTimeout)}.`] : []),
        ...(hunt.blockUnlockUntilComplete ? ['The lock cannot be unlocked until the hunt is completed.'] : []),
      ],
    });
  }
  const actionLines = config.zones.flatMap((z) => {
    const a = z.actions;
    const parts: string[] = [];
    if (a.onEnter.length) parts.push(`entering: ${list(a.onEnter)}`);
    if (a.onLeave.length) parts.push(`leaving${a.minStayMinutes ? ` after at least ${fmtMinutes(a.minStayMinutes)} inside` : ''}: ${list(a.onLeave)}`);
    return parts.length ? [`${z.name} – ${parts.join('; ')}${a.cooldownMinutes ? ` (at most every ${fmtMinutes(a.cooldownMinutes)})` : ''}.`] : [];
  });
  if (actionLines.length) out.push({ rule: 'zoneActions', title: 'Zone actions', lines: actionLines });
  const tr = config.tracking;
  if (tr.enabled) {
    out.push({
      rule: 'tracking',
      title: tr.checkins === 'auto' ? 'Live tracking (required)' : 'Background tracking',
      lines: [
        'Your phone reports its location in the background with the OwnTracks app.',
        ...(tr.checkins === 'auto' ? ['Manual check-ins are disabled – only live tracking counts.'] : []),
        `If no location arrives for ${fmtMinutes(tr.heartbeatMinutes)}: ${list(tr.onHeartbeatMissed)}.`,
        ...(tr.quietHours ? [`No missing-signal penalties between ${tr.quietHours.start} and ${tr.quietHours.end}.`] : []),
        ...(tr.warnBeforeMinutes ? [`You get a warning ${fmtMinutes(tr.warnBeforeMinutes)} before a missing-signal penalty (if notifications are set up).`] : []),
        ...(required.enabled ? ['Background locations inside a required zone count as check-ins.'] : []),
        ...(config.antiCheat.liveVerificationEveryHours ? [`Random verification pictures, on average every ${config.antiCheat.liveVerificationEveryHours} h.`] : []),
      ],
    });
  }
  return out;
}

export function fmtMinutes(min: number): string {
  if (min === 0) return '0 min';
  const d = Math.floor(min / 1440);
  const h = Math.floor((min % 1440) / 60);
  const m = min % 60;
  return [d && `${d}d`, h && `${h}h`, m && `${m}min`].filter(Boolean).join(' ');
}

export interface BuildViewInput {
  role: Role;
  isSelfLock: boolean;
  config: LockationConfig;
  state: LockationState;
  history: CheckinRecord[];
  now: Date;
}

const reachNote = (ack: { reasons: string[] } | undefined) => (ack ? `${ack.reasons.join(', ')} – confirmed as intentional by the keyholder` : undefined);

export function buildSessionView({ role, isSelfLock, config, state, history, now }: BuildViewInput): SessionView {
  const privacy = effectivePrivacy(config, state);

  const zones: ZoneView[] = config.zones.map((z) => {
    const kinds = activeRoles(config, z);
    const windows: string[] = [];
    let windowActive = false;
    if (kinds.includes('required') && z.required.stayWindows.length) {
      windows.push(`Stay inside ${z.required.stayWindows.map(formatWindow).join(', ')}`);
      windowActive ||= !!activeWindowStart(z.required.stayWindows, now, config.timezone);
    }
    if (kinds.includes('forbidden') && z.forbidden.windows.length) {
      windows.push(`Forbidden ${z.forbidden.windows.map(formatWindow).join(', ')}`);
      windowActive ||= !!activeWindowStart(z.forbidden.windows, now, config.timezone);
    }
    return { id: z.id, name: z.name, lat: z.lat, lng: z.lng, radiusM: z.radiusM, kinds, windows, windowActive, reachabilityNote: reachNote(z.reachabilityAck) };
  });

  const view: SessionView = {
    role,
    isSelfLock,
    timezone: config.timezone,
    privacy,
    privacyLocked: state.privacyOverride === 'zone_only',
    matchMode: config.matchMode,
    maxAccuracyM: config.antiCheat.maxAccuracyM,
    liveOnly: config.tracking.enabled && config.tracking.checkins === 'auto',
    zones,
    rules: summarizeRules(config),
    freezeUntil: state.freezeUntil,
    stats: { checkins: state.checkinCount, accepted: state.acceptedCount, lastCheckinAt: state.lastAttemptAt },
    history: history.map((h) => (privacy === 'exact' ? h : redactRecord(h))),
    presentZones: config.zones.filter((z) => state.presence[z.id]).map((z) => z.name),
    forbiddenVisits: [],
    rulesChanged: state.rulesChanged,
  };
  const la = state.lastAccepted;
  if (la && (role === 'wearer' || (role === 'keyholder' && privacy === 'exact'))) {
    view.lastPosition = { lat: la.lat, lng: la.lng, accuracy: la.accuracy, at: la.at, approximate: privacy !== 'exact' };
  }
  if (config.tracking.enabled) {
    const nh = state.tracking.nextHeartbeat;
    view.tracking = {
      paired: !!state.tracking.deviceUser,
      status: trackingStatus(state, config.tracking.heartbeatMinutes, now),
      pairedAt: state.tracking.pairedAt,
      lastSeenAt: state.tracking.lastSeenAt,
      nextHeartbeat: nh,
      overdue: !!nh && now.getTime() > Date.parse(nh),
      missedCount: state.tracking.missedCount,
      heartbeatMinutes: config.tracking.heartbeatMinutes,
      updates: state.tracking.trackedCount,
      signalDueAt: nextHeartbeatFrom(config, new Date(state.tracking.lastSeenAt ?? state.startedAt)).toISOString(),
      mode: owntracksModeName(config),
      receiving: !!state.tracking.lastSeenAt && (!state.tracking.pairedAt || state.tracking.lastSeenAt >= state.tracking.pairedAt),
    };
  }

  if (config.rules.forbidden.enabled) {
    for (const z of zonesWithRole(config, 'forbidden')) {
      const v = state.forbidden.visits[z.id];
      if (!v || v.leftAt) continue;
      const T = forbiddenTimings(config, z);
      view.forbiddenVisits.push({
        zone: z.name,
        since: v.since,
        penalties: v.penalties,
        nextPenaltyAt: config.tracking.enabled ? new Date(Date.parse(v.since) + (T.firstPenalty + v.penalties * T.repeatEvery) * MINUTE).toISOString() : undefined,
      });
    }
  }

  const slots = requiredSlots(config);
  if (config.rules.required.enabled) {
    view.requiredSlots = slots.map((s) => {
      const st = state.required.slots[s.key];
      return {
        key: s.key,
        name: s.name,
        nextDeadline: st?.nextDeadline,
        overdue: !!st?.nextDeadline && now.getTime() > Date.parse(st.nextDeadline),
        missedCount: st?.missedCount ?? 0,
        lastValidAt: st?.lastValidAt,
        graceMinutes: s.graceMinutes,
      };
    });
    const first = earliestDeadline(state);
    const firstSlot = first ? view.requiredSlots.find((s) => s.key === first.key) : undefined;
    if (firstSlot) {
      view.required = {
        nextDeadline: firstSlot.nextDeadline,
        overdue: view.requiredSlots.some((s) => s.overdue),
        missedCount: view.requiredSlots.reduce((a, s) => a + s.missedCount, 0),
        lastValidAt: firstSlot.lastValidAt,
        graceMinutes: firstSlot.graceMinutes,
      };
    }
  }

  const h = config.rules.hunt;
  if (h.enabled) {
    const active = state.hunt.status === 'active';
    const route = huntRoute(config, state);
    const cp = h.order === 'sequence' ? route[state.hunt.index] : undefined;
    const visible = visibleCheckpoints(config, state);
    const visibleIds = new Set(visible.map((v) => v.cp.id));
    const hiddenDifficult = route.some((c) => c.reachabilityAck && !visibleIds.has(c.id));
    const open = route.filter((c) => !state.hunt.found.includes(c.id));
    view.hunt = {
      status: state.hunt.status,
      actions: allowedHuntActions(config, state, role, isSelfLock),
      start: h.start,
      scheduledStartAt: huntScheduledStart(config, state)?.toISOString(),
      pausedAt: state.hunt.pausedAt,
      index: state.hunt.index,
      total: huntTotal(config, state),
      randomRoute: h.random.enabled ? { drawn: !!state.hunt.route, min: h.random.min, max: h.random.max, pool: h.checkpoints.length } : undefined,
      reveal: h.reveal,
      order: h.order,
      hint: active && h.order === 'sequence' ? cp?.hint : undefined,
      openHints: active && h.order === 'any' && h.reveal !== 'all' ? open.map((c) => c.hint).filter(Boolean) : undefined,
      distanceBand: h.reveal !== 'hint' && active ? state.hunt.lastDistanceBand : undefined,
      target: h.reveal === 'map' && h.order === 'sequence' && cp && active ? { lat: cp.lat, lng: cp.lng, radiusM: cp.radiusM } : undefined,
      checkpoints: h.reveal === 'all' || h.reveal === 'map' ? visible.map((v) => ({ index: v.index, name: v.cp.name, hint: v.cp.hint, lat: v.cp.lat, lng: v.cp.lng, radiusM: v.cp.radiusM, status: v.status })) : [],
      guessesAllowed: h.reveal !== 'all' && active,
      terrainNote: hiddenDifficult ? 'One or more checkpoints are in difficult terrain – confirmed as intentional by the keyholder.' : undefined,
      deadline: huntDeadlineOf(config, state)?.toISOString(),
    };
  }

  const t = config.rules.travel;
  if (t.enabled) {
    view.travel = {
      totalKm: round2(state.travel.totalKm),
      pendingKm: round2(state.travel.pendingKm),
      stepKm: t.stepKm,
      kmToday: round2(state.travel.kmToday),
      dailyCapKm: t.dailyCapKm,
    };
  }
  return view;
}

function owntracksModeName(config: LockationConfig): 'move' | 'significant' {
  return owntracksMonitoring(config) === 2 ? 'move' : 'significant';
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function redactRecord(r: CheckinRecord): CheckinRecord {
  const { lat: _lat, lng: _lng, ...rest } = r;
  return rest;
}

// ---------- F12 metadata ----------
export interface ChasterMetadata {
  reasonsPreventingUnlocking: string[];
  homeActions: { slug: string; title: string; description: string; icon: string; badge?: string }[];
}

export function computeMetadata(config: LockationConfig, state: LockationState, now: Date): ChasterMetadata {
  const reasons: string[] = [];
  const h = config.rules.hunt;
  if (h.enabled && h.blockUnlockUntilComplete && ['not_started', 'active', 'paused'].includes(state.hunt.status)) {
    reasons.push(`Scavenger hunt not completed (${state.hunt.index}/${huntTotal(config, state)} checkpoints).`);
  }
  const r = config.rules.required;
  const first = r.enabled ? earliestDeadline(state) : undefined;
  const deadline = first?.deadline;
  const overdue = r.enabled && Object.values(state.required.slots).some((s) => s.nextDeadline && now > new Date(s.nextDeadline));
  if (overdue) reasons.push('A required GPS check-in is overdue.');

  const live = config.tracking.enabled && config.tracking.checkins === 'auto';
  let description = 'Prove your location';
  if (live && !state.tracking.deviceUser) {
    description = 'Set up live tracking!';
  } else if (deadline) {
    const due = formatLocalTime(deadline, config.timezone);
    description = overdue ? (live ? 'Required location overdue!' : 'Check-in overdue!') : live ? `Be in a required zone by ${due}` : `Next check-in due ${due}`;
  } else if (live) {
    description = 'Live tracking active';
  } else if (config.tracking.enabled) {
    description = state.tracking.deviceUser ? 'Background tracking active' : 'Set up background tracking!';
  } else if (h.enabled && state.hunt.status === 'not_started') {
    description = h.start === 'wearer' ? 'Start your scavenger hunt!' : 'Scavenger hunt not started yet';
  } else if (h.enabled && state.hunt.status === 'paused') {
    description = 'Scavenger hunt paused';
  } else if (h.enabled && state.hunt.status === 'active') {
    description = `Scavenger hunt: checkpoint ${state.hunt.index + 1}/${huntTotal(config, state)}`;
  }
  return {
    reasonsPreventingUnlocking: reasons,
    homeActions: [
      { slug: 'checkin', title: live ? 'GPS live tracking' : 'GPS check-in', description, icon: 'map-marker-alt', ...(overdue || (live && !state.tracking.deviceUser) ? { badge: '!' } : {}) },
    ],
  };
}

/** One custom log entry per evaluation (F7). */
export function buildLogEntry(
  kind: 'checkin' | 'tick',
  events: string[],
  consequences: PlannedConsequence[],
  record?: CheckinRecord,
): { title: string; description: string; color: string; icon: string } | undefined {
  if (kind === 'tick' && !events.length) return undefined;
  const title =
    kind === 'tick'
      ? 'Lockation'
      : record?.outcome === 'rejected'
        ? 'GPS check-in rejected'
        : record?.source === 'tracked'
          ? record.zones.length
            ? `GPS background update: ${record.zones.join(', ')}`
            : 'GPS background update'
          : record?.zones.length
            ? `GPS check-in: ${record.zones.join(', ')}`
            : 'GPS check-in';
  const lines = [...events];
  if (consequences.length) lines.push(`Consequences: ${consequences.map((c) => describeConsequence(c.consequence)).join(', ')}.`);
  return {
    title: title.slice(0, 120),
    description: lines.join('\n').slice(0, 2000),
    color: record?.outcome === 'rejected' ? '#c0392b' : consequences.length ? '#e67e22' : '#27ae60',
    icon: 'map-marker-alt',
  };
}
