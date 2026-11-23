/** Lock configuration schema (stored as the Chaster extension `config`). */
import { z } from 'zod';
import { ConsequenceListSchema } from './consequences.js';

export const MIN_RADIUS_M = 20;
/** Below this radius the config editor warns that indoor GPS may be less precise than the zone. */
export const SMALL_RADIUS_HINT_M = 100;
/** Max. zones + hunt checkpoints per lock (iOS monitors at most 20 regions per app → everything can be synced to OwnTracks). */
export const MAX_PLACES = 20;
export const MAX_RADIUS_M = 50_000;

const lat = z.number().min(-90).max(90);
const lng = z.number().min(-180).max(180);
const radiusM = z.number().min(MIN_RADIUS_M).max(MAX_RADIUS_M);
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,40}$/);
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'expected HH:MM');

export const ZoneSchema = z.object({
  id,
  name: z.string().min(1).max(60),
  lat,
  lng,
  radiusM,
});
export type Zone = z.infer<typeof ZoneSchema>;

export const CheckpointSchema = ZoneSchema.extend({
  hint: z.string().max(500).default(''),
});
export type Checkpoint = z.infer<typeof CheckpointSchema>;

const RequiredRuleSchema = z
  .object({
    enabled: z.boolean().default(false),
    zoneIds: z.array(id).default([]),
    intervalMinutes: z.number().int().min(15).max(43_200).default(240),
    graceMinutes: z.number().int().min(0).max(1440).default(15),
    quietHours: z.object({ start: hhmm, end: hhmm }).optional(),
    onSuccess: ConsequenceListSchema,
    onOutside: ConsequenceListSchema,
    onMissed: ConsequenceListSchema,
  })
  .default({});

const ForbiddenRuleSchema = z
  .object({
    enabled: z.boolean().default(false),
    zoneIds: z.array(id).default([]),
    cooldownMinutes: z.number().int().min(0).max(10_080).default(60),
    onEnter: ConsequenceListSchema,
  })
  .default({});

const RewardRuleSchema = z
  .object({
    enabled: z.boolean().default(false),
    zoneIds: z.array(id).default([]),
    cooldownMinutes: z.number().int().min(0).max(10_080).default(720),
    maxPerDay: z.number().int().min(1).max(100).default(1),
    /** F14 – minutes of continuous presence required before the reward (0 = immediately). */
    dwellMinutes: z.number().int().min(0).max(1440).default(0),
    onEnter: ConsequenceListSchema,
  })
  .default({});

const CurfewRuleSchema = z
  .object({
    enabled: z.boolean().default(false),
    zoneIds: z.array(id).default([]),
    start: hhmm.default('22:00'),
    end: hhmm.default('06:00'),
    cooldownMinutes: z.number().int().min(0).max(10_080).default(60),
    onOutside: ConsequenceListSchema,
  })
  .default({});

export const TrackingSchema = z
  .object({
    enabled: z.boolean().default(false),
    heartbeatMinutes: z.number().int().min(15).max(10_080).default(20),
    onHeartbeatMissed: ConsequenceListSchema,
    entryConfirmMinutes: z.number().int().min(0).max(120).default(3),
    maxDelayMinutes: z.number().int().min(1).max(10_080).default(1440),
    countsAsCheckin: z.boolean().default(true),
    /** F16 – live tracking only: manual check-ins are disabled, every rule runs on background updates. */
    liveOnly: z.boolean().default(false),
  })
  .default({});

const TravelRuleSchema = z
  .object({
    enabled: z.boolean().default(false),
    stepKm: z.number().min(0.1).max(1000).default(1),
    maxKmPerCheckin: z.number().min(0.1).max(10_000).default(50),
    dailyCapKm: z.number().min(0.1).max(10_000).default(100),
    onStep: ConsequenceListSchema,
  })
  .default({});

const HuntRuleSchema = z
  .object({
    enabled: z.boolean().default(false),
    checkpoints: z.array(CheckpointSchema).max(MAX_PLACES).default([]),
    reveal: z.enum(['hint', 'distance', 'map']).default('distance'),
    wrongCooldownMinutes: z.number().int().min(0).max(1440).default(10),
    timeLimitMinutes: z.number().int().min(10).max(525_600).optional(),
    blockUnlockUntilComplete: z.boolean().default(false),
    onCheckpoint: ConsequenceListSchema,
    onWrong: ConsequenceListSchema,
    onComplete: ConsequenceListSchema,
    onTimeout: ConsequenceListSchema,
  })
  .default({});

export const AntiCheatSchema = z
  .object({
    maxAccuracyM: z.number().min(10).max(500).default(100),
    maxFixAgeSeconds: z.number().int().min(10).max(3600).default(120),
    maxSpeedKmh: z.number().min(5).max(1200).default(200),
    onImplausible: z.enum(['reject', 'reject_and_penalize', 'accept_and_verify']).default('reject'),
    implausibleConsequences: ConsequenceListSchema,
    verificationPicture: z.enum(['never', 'always', 'random']).default('never'),
    verificationProbability: z.number().min(0).max(1).default(0.2),
    minIntervalSeconds: z.number().int().min(0).max(86_400).default(60),
  })
  .default({});
export type AntiCheat = z.infer<typeof AntiCheatSchema>;

export const PrivacySchema = z
  .object({ coordinates: z.enum(['zone_only', 'exact']).default('zone_only') })
  .default({});
export type CoordinatePrivacy = 'zone_only' | 'exact';

export const LockationConfigSchema = z
  .object({
    version: z.literal(1).default(1),
    timezone: z.string().min(1).max(64).default('UTC'),
    matchMode: z.enum(['lenient', 'strict']).default('lenient'),
    zones: z.array(ZoneSchema).max(MAX_PLACES).default([]),
    rules: z
      .object({
        required: RequiredRuleSchema,
        forbidden: ForbiddenRuleSchema,
        reward: RewardRuleSchema,
        travel: TravelRuleSchema,
        hunt: HuntRuleSchema,
        curfew: CurfewRuleSchema,
      })
      .default({}),
    tracking: TrackingSchema,
    antiCheat: AntiCheatSchema,
    privacy: PrivacySchema,
    /** Keyholder accepted the disclaimer (checked on save, not on read – old configs stay readable). */
    disclaimer: z.object({ version: z.number().int().min(1), acceptedAt: z.string().max(40) }).optional(),
  })
  .superRefine((cfg, ctx) => {
    const places = cfg.zones.length + cfg.rules.hunt.checkpoints.length;
    if (places > MAX_PLACES) {
      ctx.addIssue({ code: 'custom', path: ['zones'], message: `at most ${MAX_PLACES} zones and hunt checkpoints in total (currently ${places})` });
    }
    const ids = new Set<string>();
    cfg.zones.forEach((z, i) => {
      if (ids.has(z.id)) ctx.addIssue({ code: 'custom', path: ['zones', i, 'id'], message: `duplicate zone id "${z.id}"` });
      ids.add(z.id);
    });
    if (!isValidTimezone(cfg.timezone)) {
      ctx.addIssue({ code: 'custom', path: ['timezone'], message: `unknown timezone "${cfg.timezone}"` });
    }
    if (cfg.rules.curfew.enabled) {
      if (cfg.rules.curfew.zoneIds.length === 0) {
        ctx.addIssue({ code: 'custom', path: ['rules', 'curfew', 'zoneIds'], message: 'select at least one curfew zone' });
      }
      if (!cfg.tracking.enabled) {
        ctx.addIssue({ code: 'custom', path: ['rules', 'curfew', 'enabled'], message: 'a curfew needs background tracking to be enabled' });
      }
    }
    if (cfg.tracking.liveOnly && !cfg.tracking.enabled) {
      ctx.addIssue({ code: 'custom', path: ['tracking', 'liveOnly'], message: 'live tracking only needs background tracking to be enabled' });
    }
    for (const rule of ['required', 'forbidden', 'reward', 'curfew'] as const) {
      cfg.rules[rule].zoneIds.forEach((zid, i) => {
        if (!ids.has(zid)) {
          ctx.addIssue({ code: 'custom', path: ['rules', rule, 'zoneIds', i], message: `unknown zone "${zid}"` });
        }
      });
    }
    if (cfg.rules.forbidden.enabled && cfg.rules.forbidden.zoneIds.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['rules', 'forbidden', 'zoneIds'], message: 'select at least one forbidden zone' });
    }
    if (cfg.rules.reward.enabled && cfg.rules.reward.zoneIds.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['rules', 'reward', 'zoneIds'], message: 'select at least one reward zone' });
    }
    const forbidden = new Set(cfg.rules.forbidden.enabled ? cfg.rules.forbidden.zoneIds : []);
    cfg.rules.required.zoneIds.forEach((zid, i) => {
      if (cfg.rules.required.enabled && forbidden.has(zid)) {
        ctx.addIssue({ code: 'custom', path: ['rules', 'required', 'zoneIds', i], message: 'a zone cannot be both required and forbidden' });
      }
    });
    if (cfg.rules.hunt.enabled && cfg.rules.hunt.checkpoints.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['rules', 'hunt', 'checkpoints'], message: 'add at least one checkpoint' });
    }
    const cpIds = new Set<string>();
    cfg.rules.hunt.checkpoints.forEach((c, i) => {
      if (cpIds.has(c.id)) ctx.addIssue({ code: 'custom', path: ['rules', 'hunt', 'checkpoints', i, 'id'], message: `duplicate checkpoint id "${c.id}"` });
      cpIds.add(c.id);
    });
  });

export type LockationConfig = z.infer<typeof LockationConfigSchema>;

/** Bump when the disclaimer text changes materially – keyholders must accept again on the next save. */
export const DISCLAIMER_VERSION = 1;

export function disclaimerAccepted(config: Pick<LockationConfig, 'disclaimer'>): boolean {
  return (config.disclaimer?.version ?? 0) >= DISCLAIMER_VERSION;
}
export type LockationConfigInput = z.input<typeof LockationConfigSchema>;

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function defaultConfig(timezone = 'UTC'): LockationConfig {
  return LockationConfigSchema.parse({ timezone });
}

export interface ConfigIssue {
  path: string;
  message: string;
}

export type ParseConfigResult = { ok: true; config: LockationConfig } | { ok: false; issues: ConfigIssue[] };

/** Parse unknown input (from Chaster or the config page) into a full config. */
export function parseConfig(input: unknown): ParseConfigResult {
  const res = LockationConfigSchema.safeParse(input ?? {});
  if (res.success) return { ok: true, config: res.data };
  return {
    ok: false,
    issues: res.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
  };
}

/** Lenient variant for stored configs: falls back to defaults instead of failing hard. */
export function parseConfigOrDefault(input: unknown): LockationConfig {
  const res = parseConfig(input);
  return res.ok ? res.config : defaultConfig();
}

export function enabledRules(cfg: LockationConfig): string[] {
  return [
    ...(Object.keys(cfg.rules) as (keyof LockationConfig['rules'])[]).filter((k) => cfg.rules[k].enabled),
    ...(cfg.tracking.enabled ? ['tracking'] : []),
  ];
}
