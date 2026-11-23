/** Engine state, stored in Chaster session data under `lockation`. */
import { z } from 'zod';
import type { LockationConfig } from './config.js';
import { adjustForQuietHours, MINUTE } from './time.js';

const iso = z.string();

export const LockationStateSchema = z.object({
  v: z.literal(1).default(1),
  startedAt: iso,
  lastAttemptAt: iso.optional(),
  lastAccepted: z.object({ lat: z.number(), lng: z.number(), accuracy: z.number(), at: iso }).optional(),
  privacyOverride: z.literal('zone_only').optional(),
  required: z
    .object({
      lastValidAt: iso.optional(),
      nextDeadline: iso.optional(),
      missedCount: z.number().default(0),
      /** A deadline was missed and no valid check-in has happened since (F16 recovery). */
      missedSinceValid: z.boolean().optional(),
    })
    .default({}),
  forbidden: z.object({ lastTriggered: z.record(iso).default({}) }).default({}),
  reward: z
    .object({ lastTriggered: z.record(iso).default({}), day: z.string().default(''), countToday: z.number().default(0) })
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
      index: z.number().int().default(0),
      status: z.enum(['active', 'completed', 'failed']).default('active'),
      startedAt: iso.optional(),
      lastWrongAt: iso.optional(),
      lastDistanceBand: z.string().optional(),
    })
    .default({}),
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
    })
    .default({}),
  curfew: z.object({ lastTriggered: iso.optional() }).default({}),
  freezeUntil: iso.optional(),
  checkinCount: z.number().default(0),
  acceptedCount: z.number().default(0),
});

export type LockationState = z.infer<typeof LockationStateSchema>;

export function initialState(config: LockationConfig, startedAt: Date): LockationState {
  const state = LockationStateSchema.parse({ startedAt: startedAt.toISOString() });
  state.hunt.startedAt = startedAt.toISOString();
  if (config.rules.required.enabled) {
    state.required.nextDeadline = computeDeadline(config, startedAt).toISOString();
  }
  if (config.tracking.enabled) {
    state.tracking.nextHeartbeat = new Date(startedAt.getTime() + config.tracking.heartbeatMinutes * MINUTE).toISOString();
  }
  return state;
}

/** Parse stored state; returns a fresh state when missing or corrupt. */
export function loadState(raw: unknown, config: LockationConfig, fallbackStart: Date): LockationState {
  const res = LockationStateSchema.safeParse(raw);
  return res.success ? res.data : initialState(config, fallbackStart);
}

export function computeDeadline(config: LockationConfig, from: Date): Date {
  const r = config.rules.required;
  return adjustForQuietHours(new Date(from.getTime() + r.intervalMinutes * MINUTE), r.quietHours, config.timezone);
}

export function effectivePrivacy(config: LockationConfig, state: LockationState) {
  return state.privacyOverride ?? config.privacy.coordinates;
}

export function cloneState(s: LockationState): LockationState {
  return JSON.parse(JSON.stringify(s)) as LockationState;
}
