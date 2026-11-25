/** Engine state, stored in Chaster session data under `lockation`. */
import { z } from 'zod';
import type { Consequence } from './consequences.js';
import { type LockationConfig, zonesWithRole } from './config.js';
import { adjustForQuietHours, isInQuietHours, MINUTE } from './time.js';

const iso = z.string();

/** One required check-in deadline ("slot"): `*` = anywhere, else a zone id. */
const SlotSchema = z.object({
  lastValidAt: iso.optional(),
  nextDeadline: iso.optional(),
  missedCount: z.number().default(0),
  /** A deadline was missed and no valid check-in has happened since (recovery → onSuccess once). */
  missedSinceValid: z.boolean().optional(),
  /** Deadline for which the "check-in due soon" warning was sent. */
  warnedFor: iso.optional(),
});
export type SlotState = z.infer<typeof SlotSchema>;

/** A stay in a forbidden zone with its escalation progress. */
const VisitSchema = z.object({
  /** Start of the counted stay (entry, or window start if the wearer was already inside). */
  since: iso,
  lastInside: iso,
  /** Set when the wearer has clearly left; a re-entry within `repeatEvery` continues the visit. */
  leftAt: iso.optional(),
  penalties: z.number().int().default(0),
  lastPenaltyAt: iso.optional(),
  /** Number of the last warning step sent (0 = first warning, n = warning after the n-th penalty). */
  warnedStep: z.number().int().default(-1),
});
export type VisitState = z.infer<typeof VisitSchema>;

export const LockationStateSchema = z.object({
  v: z.literal(2).default(2),
  startedAt: iso,
  lastAttemptAt: iso.optional(),
  lastAccepted: z.object({ lat: z.number(), lng: z.number(), accuracy: z.number(), at: iso }).optional(),
  privacyOverride: z.literal('zone_only').optional(),
  required: z
    .object({
      slots: z.record(SlotSchema).default({}),
      /** Last time the "must stay inside" window rule was applied (cooldown). */
      windowLastTriggered: iso.optional(),
    })
    .default({}),
  forbidden: z.object({ visits: z.record(VisitSchema).default({}) }).default({}),
  reward: z
    .object({
      lastTriggered: z.record(iso).default({}),
      day: z.string().default(''),
      countToday: z.number().default(0),
      countByZone: z.record(z.number()).default({}),
    })
    .default({}),
  travel: z
    .object({
      pendingKm: z.number().default(0),
      totalKm: z.number().default(0),
      day: z.string().default(''),
      kmToday: z.number().default(0),
    })
    .default({}),
  hunt: z
    .object({
      /** Sequence mode: index of the current checkpoint. Any-order mode: equals `found.length`. */
      index: z.number().int().default(0),
      found: z.array(z.string()).default([]),
      /** Random route (checkpoint ids in hunt order), drawn when a randomized hunt starts. */
      route: z.array(z.string()).optional(),
      /** not_started → active ⇄ paused → completed | failed (timeout, wearer abort) | aborted (keyholder). */
      status: z.enum(['not_started', 'active', 'paused', 'completed', 'failed', 'aborted']).default('active'),
      startedAt: iso.optional(),
      pausedAt: iso.optional(),
      /** Total paused time (ms) – extends the time limit. */
      pausedMs: z.number().default(0),
      lastWrongAt: iso.optional(),
      lastDistanceBand: z.string().optional(),
    })
    .default({}),
  /** F25 – surprise missions. */
  mission: z
    .object({
      active: z
        .object({ id: z.string(), zoneId: z.string(), issuedAt: iso, dueAt: iso, by: z.enum(['random', 'keyholder']), warned: z.boolean().default(false) })
        .optional(),
      /** When the next random mission comes (within the active hours). */
      nextRandomAt: iso.optional(),
      declineDay: z.string().default(''),
      declinesToday: z.number().default(0),
      succeeded: z.number().default(0),
      failed: z.number().default(0),
      declined: z.number().default(0),
      last: z.object({ zoneId: z.string(), outcome: z.enum(['success', 'failed', 'declined', 'cancelled']), at: iso }).optional(),
    })
    .default({}),
  /** Last run of the enter / leave actions per zone (cooldown). */
  zoneActions: z.record(z.object({ lastEnter: iso.optional(), lastLeave: iso.optional() })).default({}),
  /** F14 – zones the wearer is currently in (since = first seen, lastSeen = latest observation inside). */
  presence: z.record(z.object({ since: iso, lastSeen: iso })).default({}),
  tracking: z
    .object({
      deviceUser: z.string().optional(),
      pairedAt: iso.optional(),
      lastSeenAt: iso.optional(),
      nextHeartbeat: iso.optional(),
      missedCount: z.number().default(0),
      waypointsHash: z.string().optional(),
      trackedCount: z.number().default(0),
      /** OwnTracks monitoring mode last sent to the phone (1 significant, 2 move). */
      monitoring: z.number().int().optional(),
      /** OwnTracks report interval (s) last sent to the phone. */
      locatorInterval: z.number().int().optional(),
      /** Heartbeat deadline for which the missing-signal warning was sent. */
      warnedFor: iso.optional(),
      /** First manual send (OwnTracks ↑) after pairing – completes the setup. */
      verifiedAt: iso.optional(),
    })
    .default({}),
  /** Live-only locks: next random verification picture. */
  nextLiveVerification: iso.optional(),
  /** Summary of the last configuration change during the lock, shown to the wearer until acknowledged. */
  rulesChanged: z.object({ at: iso, summary: z.array(z.string()).max(50) }).optional(),
  freezeUntil: iso.optional(),
  checkinCount: z.number().default(0),
  acceptedCount: z.number().default(0),
});

export type LockationState = z.infer<typeof LockationStateSchema>;

// ---------- required slots ----------

export interface RequiredSlot {
  key: string;
  /** Display name ("anywhere", a zone name, or "Home or Work"). */
  name: string;
  /** Zones that satisfy the slot; `null` = anywhere. */
  zoneIds: string[] | null;
  intervalMinutes: number;
  graceMinutes: number;
  onMissed: Consequence[];
  onSuccess: Consequence[];
}

export const ANYWHERE_SLOT = '*';

export function requiredSlots(config: LockationConfig): RequiredSlot[] {
  const r = config.rules.required;
  if (!r.enabled) return [];
  const out: RequiredSlot[] = [];
  if (r.anywhere) {
    out.push({ key: ANYWHERE_SLOT, name: 'anywhere', zoneIds: null, intervalMinutes: r.intervalMinutes, graceMinutes: r.graceMinutes, onMissed: r.onMissed, onSuccess: r.onSuccess });
  }
  const zones = zonesWithRole(config, 'required').filter((z) => z.required.intervalCheckins);
  for (const z of zones) {
    out.push({
      key: z.id,
      name: z.name,
      zoneIds: [z.id],
      intervalMinutes: z.required.intervalMinutes ?? r.intervalMinutes,
      graceMinutes: z.required.graceMinutes ?? r.graceMinutes,
      onMissed: [...r.onMissed, ...z.required.onMissed],
      onSuccess: [...r.onSuccess, ...z.required.onSuccess],
    });
  }
  return out;
}

export function computeDeadline(config: LockationConfig, from: Date, slot?: Pick<RequiredSlot, 'intervalMinutes'>): Date {
  const r = config.rules.required;
  const interval = slot?.intervalMinutes ?? r.intervalMinutes;
  return adjustForQuietHours(new Date(from.getTime() + interval * MINUTE), r.quietHours, config.timezone);
}

/** Add missing slots (deadline from `from`) and drop slots that are no longer configured. Mutates `state`. */
export function syncSlots(config: LockationConfig, state: LockationState, from: Date) {
  const slots = requiredSlots(config);
  const keys = new Set(slots.map((s) => s.key));
  for (const k of Object.keys(state.required.slots)) if (!keys.has(k)) delete state.required.slots[k];
  for (const s of slots) {
    if (!state.required.slots[s.key]) state.required.slots[s.key] = { missedCount: 0, nextDeadline: computeDeadline(config, from, s).toISOString() };
  }
}

/** Earliest deadline over all slots (for the lock page action and the unlock blocker). */
export function earliestDeadline(state: LockationState): { key: string; deadline: Date } | undefined {
  let best: { key: string; deadline: Date } | undefined;
  for (const [key, s] of Object.entries(state.required.slots)) {
    if (!s.nextDeadline) continue;
    const d = new Date(s.nextDeadline);
    if (!best || d < best.deadline) best = { key, deadline: d };
  }
  return best;
}

/** Next missing-signal deadline after `from`; deadlines inside quiet hours move to their end + one full period. */
export function nextHeartbeatFrom(config: LockationConfig, from: Date): Date {
  const tr = config.tracking;
  const hb = tr.heartbeatMinutes * MINUTE;
  const due = new Date(from.getTime() + hb);
  if (tr.quietHours && isInQuietHours(due, tr.quietHours, config.timezone)) {
    return new Date(adjustForQuietHours(due, tr.quietHours, config.timezone).getTime() + hb);
  }
  return due;
}

// ---------- lifecycle ----------

export function initialState(config: LockationConfig, startedAt: Date): LockationState {
  const state = LockationStateSchema.parse({ startedAt: startedAt.toISOString() });
  if (config.rules.hunt.start === 'auto') state.hunt.startedAt = startedAt.toISOString();
  else state.hunt.status = 'not_started';
  syncSlots(config, state, startedAt);
  if (config.tracking.enabled) {
    state.tracking.nextHeartbeat = nextHeartbeatFrom(config, startedAt).toISOString();
  }
  return state;
}

/** Parse stored state; returns a fresh state when missing or corrupt. Slots are synced to the config. */
export function loadState(raw: unknown, config: LockationConfig, fallbackStart: Date, now: Date = fallbackStart): LockationState {
  const res = LockationStateSchema.safeParse(raw);
  const state = res.success ? res.data : initialState(config, fallbackStart);
  syncSlots(config, state, now);
  return state;
}

export function effectivePrivacy(config: LockationConfig, state: LockationState) {
  return state.privacyOverride ?? config.privacy.coordinates;
}

export function cloneState(s: LockationState): LockationState {
  return JSON.parse(JSON.stringify(s)) as LockationState;
}
