/** View models sent to the browser, Chaster metadata (F12) and privacy helpers (F9). */
import type { LockationConfig } from './config.js';
import { describeConsequence, type Consequence } from './consequences.js';
import type { CheckinRecord, PlannedConsequence } from './engine.js';
import { effectivePrivacy, type LockationState } from './state.js';
import { formatLocalTime, MINUTE } from './time.js';

export type Role = 'wearer' | 'keyholder';

export interface ZoneView {
  id: string;
  name: string;
  lat: number;
  lng: number;
  radiusM: number;
  kinds: ('required' | 'forbidden' | 'reward')[];
}

export interface RuleSummary {
  rule: 'required' | 'forbidden' | 'reward' | 'travel' | 'hunt' | 'curfew' | 'tracking';
  title: string;
  lines: string[];
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
  required?: { nextDeadline?: string; overdue: boolean; missedCount: number; lastValidAt?: string; graceMinutes: number };
  hunt?: {
    status: 'active' | 'completed' | 'failed';
    index: number;
    total: number;
    reveal: 'hint' | 'distance' | 'map';
    hint?: string;
    distanceBand?: string;
    target?: { lat: number; lng: number; radiusM: number };
    deadline?: string;
  };
  travel?: { totalKm: number; pendingKm: number; stepKm: number; kmToday: number; dailyCapKm: number };
  freezeUntil?: string;
  /** F14 – background tracking status. */
  tracking?: { paired: boolean; pairedAt?: string; lastSeenAt?: string; nextHeartbeat?: string; overdue: boolean; missedCount: number; heartbeatMinutes: number; updates: number };
  /** Zones the wearer is currently known to be in (from check-ins and tracking). */
  presentZones: string[];
  stats: { checkins: number; accepted: number; lastCheckinAt?: string };
  history: CheckinRecord[];
}

const list = (cs: Consequence[]) => (cs.length ? cs.map(describeConsequence).join(', ') : 'nothing');

export function summarizeRules(config: LockationConfig): RuleSummary[] {
  const names = new Map(config.zones.map((z) => [z.id, z.name]));
  const zoneNames = (ids: string[]) => ids.map((i) => names.get(i) ?? i).join(', ');
  const out: RuleSummary[] = [];
  const { required, forbidden, reward, travel, hunt, curfew } = config.rules;
  if (required.enabled) {
    out.push({
      rule: 'required',
      title: 'Required check-in',
      lines: [
        `Check in ${required.zoneIds.length ? `inside ${zoneNames(required.zoneIds)}` : 'anywhere'} at least every ${fmtMinutes(required.intervalMinutes)} (grace ${fmtMinutes(required.graceMinutes)}).`,
        ...(required.quietHours ? [`No check-ins required between ${required.quietHours.start} and ${required.quietHours.end}.`] : []),
        `Missed: ${list(required.onMissed)}.`,
        ...(required.onOutside.length ? [`Checked in outside: ${list(required.onOutside)}.`] : []),
        ...(required.onSuccess.length ? [`Successful check-in: ${list(required.onSuccess)}.`] : []),
      ],
    });
  }
  if (forbidden.enabled) {
    out.push({
      rule: 'forbidden',
      title: 'Forbidden zones',
      lines: [`Checking in inside ${zoneNames(forbidden.zoneIds)}: ${list(forbidden.onEnter)}.`],
    });
  }
  if (reward.enabled) {
    out.push({
      rule: 'reward',
      title: 'Reward zones',
      lines: [
        `Checking in inside ${zoneNames(reward.zoneIds)}: ${list(reward.onEnter)}.`,
        `At most ${reward.maxPerDay}× per day, cooldown ${fmtMinutes(reward.cooldownMinutes)} per zone.`,
        ...(reward.dwellMinutes ? [`You must stay at least ${fmtMinutes(reward.dwellMinutes)} in the zone.`] : []),
      ],
    });
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
        `${hunt.checkpoints.length} checkpoints in a fixed order.`,
        `Each checkpoint: ${list(hunt.onCheckpoint)}. Completed: ${list(hunt.onComplete)}.`,
        `Wrong hunt check-in: ${list(hunt.onWrong)}.`,
        ...(hunt.timeLimitMinutes ? [`Time limit ${fmtMinutes(hunt.timeLimitMinutes)}: ${list(hunt.onTimeout)}.`] : []),
        ...(hunt.blockUnlockUntilComplete ? ['The lock cannot be unlocked until the hunt is completed.'] : []),
      ],
    });
  }
  if (curfew.enabled) {
    out.push({
      rule: 'curfew',
      title: 'Curfew',
      lines: [`Between ${curfew.start} and ${curfew.end} you must stay inside ${zoneNames(curfew.zoneIds)}. Being outside: ${list(curfew.onOutside)}.`],
    });
  }
  const tr = config.tracking;
  if (tr.enabled) {
    out.push({
      rule: 'tracking',
      title: tr.liveOnly ? 'Live tracking (required)' : 'Background tracking',
      lines: [
        'Your phone reports its location in the background with the OwnTracks app.',
        ...(tr.liveOnly ? ['Manual check-ins are disabled – only live tracking counts.'] : []),
        `If no location arrives for ${fmtMinutes(tr.heartbeatMinutes)}: ${list(tr.onHeartbeatMissed)}.`,
        ...(forbidden.enabled && tr.entryConfirmMinutes ? [`Forbidden zones count after ${fmtMinutes(tr.entryConfirmMinutes)} inside.`] : []),
        ...((tr.countsAsCheckin || tr.liveOnly) && required.enabled ? ['Background locations inside a required zone count as check-ins.'] : []),
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

export function buildSessionView({ role, isSelfLock, config, state, history, now }: BuildViewInput): SessionView {
  const privacy = effectivePrivacy(config, state);
  const kinds = new Map<string, ZoneView['kinds']>();
  const mark = (ids: string[], k: ZoneView['kinds'][number], on: boolean) => {
    if (on) for (const id of ids) kinds.set(id, [...(kinds.get(id) ?? []), k]);
  };
  mark(config.rules.required.zoneIds, 'required', config.rules.required.enabled);
  mark(config.rules.forbidden.zoneIds, 'forbidden', config.rules.forbidden.enabled);
  mark(config.rules.reward.zoneIds, 'reward', config.rules.reward.enabled);

  const view: SessionView = {
    role,
    isSelfLock,
    timezone: config.timezone,
    privacy,
    privacyLocked: state.privacyOverride === 'zone_only',
    matchMode: config.matchMode,
    maxAccuracyM: config.antiCheat.maxAccuracyM,
    liveOnly: config.tracking.enabled && config.tracking.liveOnly,
    zones: config.zones.map((z) => ({ ...z, kinds: kinds.get(z.id) ?? [] })),
    rules: summarizeRules(config),
    freezeUntil: state.freezeUntil,
    stats: { checkins: state.checkinCount, accepted: state.acceptedCount, lastCheckinAt: state.lastAttemptAt },
    history: history.map((h) => (privacy === 'exact' ? h : redactRecord(h))),
    presentZones: config.zones.filter((z) => state.presence[z.id]).map((z) => z.name),
  };
  if (config.tracking.enabled) {
    const nh = state.tracking.nextHeartbeat;
    view.tracking = {
      paired: !!state.tracking.deviceUser,
      pairedAt: state.tracking.pairedAt,
      lastSeenAt: state.tracking.lastSeenAt,
      nextHeartbeat: nh,
      overdue: !!nh && now.getTime() > Date.parse(nh),
      missedCount: state.tracking.missedCount,
      heartbeatMinutes: config.tracking.heartbeatMinutes,
      updates: state.tracking.trackedCount,
    };
  }

  const r = config.rules.required;
  if (r.enabled) {
    const deadline = state.required.nextDeadline;
    view.required = {
      nextDeadline: deadline,
      overdue: !!deadline && now.getTime() > Date.parse(deadline),
      missedCount: state.required.missedCount,
      lastValidAt: state.required.lastValidAt,
      graceMinutes: r.graceMinutes,
    };
  }

  const h = config.rules.hunt;
  if (h.enabled) {
    const cp = h.checkpoints[state.hunt.index];
    // Only the current checkpoint is ever revealed (F6 AC3). The keyholder sees everything in the config page.
    view.hunt = {
      status: state.hunt.status,
      index: state.hunt.index,
      total: h.checkpoints.length,
      reveal: h.reveal,
      hint: state.hunt.status === 'active' ? cp?.hint : undefined,
      distanceBand: h.reveal !== 'hint' && state.hunt.status === 'active' ? state.hunt.lastDistanceBand : undefined,
      target: h.reveal === 'map' && cp && state.hunt.status === 'active' ? { lat: cp.lat, lng: cp.lng, radiusM: cp.radiusM } : undefined,
      deadline: h.timeLimitMinutes
        ? new Date(Date.parse(state.hunt.startedAt ?? state.startedAt) + h.timeLimitMinutes * MINUTE).toISOString()
        : undefined,
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
  if (h.enabled && h.blockUnlockUntilComplete && state.hunt.status === 'active') {
    reasons.push(`Scavenger hunt not completed (${state.hunt.index}/${h.checkpoints.length} checkpoints).`);
  }
  const r = config.rules.required;
  const deadline = state.required.nextDeadline ? new Date(state.required.nextDeadline) : undefined;
  const overdue = r.enabled && !!deadline && now > deadline;
  if (overdue) reasons.push('A required GPS check-in is overdue.');

  const live = config.tracking.enabled && config.tracking.liveOnly;
  let description = 'Prove your location';
  if (live && !state.tracking.deviceUser) {
    description = 'Set up live tracking!';
  } else if (r.enabled && deadline) {
    const due = formatLocalTime(deadline, config.timezone);
    description = overdue ? (live ? 'Required location overdue!' : 'Check-in overdue!') : live ? `Be in a required zone by ${due}` : `Next check-in due ${due}`;
  } else if (live) {
    description = 'Live tracking active';
  } else if (config.tracking.enabled) {
    description = state.tracking.deviceUser ? 'Background tracking active' : 'Set up background tracking!';
  } else if (h.enabled && state.hunt.status === 'active') {
    description = `Scavenger hunt: checkpoint ${state.hunt.index + 1}/${h.checkpoints.length}`;
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
