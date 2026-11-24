/**
 * Lock configuration schema (stored as the Chaster extension `config`).
 *
 * Version 2 (2026-11-23): zones carry roles (required and/or reward, or forbidden, or neutral) and per-zone settings;
 * the curfew became "stay windows" of required zones; forbidden zones escalate with warnings. Version 1 configs are
 * migrated on read by `migrateConfig` (see the bottom of this file), so stored v1 configs keep their behaviour.
 */
import { z } from 'zod';
import { ConsequenceListSchema } from './consequences.js';

export const CONFIG_VERSION = 2;
export const MIN_RADIUS_M = 20;
/** Below this radius the config editor warns that indoor GPS may be less precise than the zone. */
export const SMALL_RADIUS_HINT_M = 100;
/** Max. zones + hunt checkpoints per lock (iOS monitors at most 20 regions per app → everything can be synced to OwnTracks). */
export const MAX_PLACES = 20;
export const MAX_RADIUS_M = 50_000;
export const MAX_WINDOWS = 10;

const lat = z.number().min(-90).max(90);
const lng = z.number().min(-180).max(180);
const radiusM = z.number().min(MIN_RADIUS_M).max(MAX_RADIUS_M);
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,40}$/);
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'expected HH:MM');
const minutes = (max: number) => z.number().int().min(0).max(max);

export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

/** A daily time window in the lock timezone; may cross midnight (it then belongs to the day it starts). */
export const WindowSchema = z.object({
  start: hhmm,
  end: hhmm,
  /** Days on which the window starts. Missing/empty = every day. */
  days: z.array(z.enum(WEEKDAYS)).max(7).optional(),
});
export type TimeWindow = z.infer<typeof WindowSchema>;

export const MatchModeSchema = z.enum(['lenient', 'strict']);
export const ZoneRoleSchema = z.enum(['required', 'reward', 'forbidden']);
export type ZoneRole = z.infer<typeof ZoneRoleSchema>;

/** F17 – the keyholder confirmed that a flagged place is intentionally hard to reach. */
export const ReachabilityAckSchema = z.object({
  reasons: z.array(z.string().min(1).max(60)).min(1).max(10),
  at: z.string().max(40),
});

const ZoneRequiredSchema = z
  .object({
    /** Interval check-ins for this zone (false = only stay windows, e.g. a migrated curfew zone). */
    intervalCheckins: z.boolean().default(true),
    intervalMinutes: z.number().int().min(1).max(43_200).optional(),
    graceMinutes: minutes(1440).optional(),
    /** "Must stay inside" windows (former curfew). Needs background tracking. */
    stayWindows: z.array(WindowSchema).max(MAX_WINDOWS).default([]),
    onMissed: ConsequenceListSchema,
    onSuccess: ConsequenceListSchema,
    onOutsideDuringWindow: ConsequenceListSchema,
  })
  .default({});

/** Forbidden-zone escalation timings. `null` switches a warning off; `undefined` (per zone) inherits the rule value. */
const nullableMinutes = (max: number) => minutes(max).nullable();

const ZoneForbiddenSchema = z
  .object({
    /** Forbidden only during these windows. Empty = always forbidden. */
    windows: z.array(WindowSchema).max(MAX_WINDOWS).default([]),
    firstWarningAfterMinutes: nullableMinutes(1440).optional(),
    firstPenaltyAfterMinutes: minutes(1440).optional(),
    repeatEveryMinutes: z.number().int().min(5).max(10_080).optional(),
    repeatWarningAfterMinutes: nullableMinutes(10_080).optional(),
    /** Extra punishment for this zone, applied after the rule's common list at every penalty. */
    onEnter: ConsequenceListSchema,
  })
  .default({});

const ZoneRewardSchema = z
  .object({
    cooldownMinutes: minutes(10_080).optional(),
    maxPerDay: z.number().int().min(1).max(100).optional(),
    dwellMinutes: minutes(1440).optional(),
    onEnter: ConsequenceListSchema,
  })
  .default({});

export const ZoneSchema = z.object({
  id,
  name: z.string().min(1).max(60),
  lat,
  lng,
  radiusM,
  /** Empty = neutral. `forbidden` excludes every other role. */
  roles: z.array(ZoneRoleSchema).max(2).default([]),
  /** Overrides the lock-wide match mode. */
  matchMode: MatchModeSchema.optional(),
  required: ZoneRequiredSchema,
  forbidden: ZoneForbiddenSchema,
  reward: ZoneRewardSchema,
  reachabilityAck: ReachabilityAckSchema.optional(),
});
export type Zone = z.infer<typeof ZoneSchema>;

export const CheckpointSchema = z.object({
  id,
  name: z.string().min(1).max(60),
  lat,
  lng,
  radiusM,
  hint: z.string().max(500).default(''),
  matchMode: MatchModeSchema.optional(),
  reachabilityAck: ReachabilityAckSchema.optional(),
});
export type Checkpoint = z.infer<typeof CheckpointSchema>;

const RequiredRuleSchema = z
  .object({
    enabled: z.boolean().default(false),
    /** Also require a check-in anywhere (no zone) every interval. */
    anywhere: z.boolean().default(false),
    /** `each` = every required zone has its own deadline; `any` = one shared deadline (v1 behaviour). */
    combine: z.enum(['each', 'any']).default('each'),
    intervalMinutes: z.number().int().min(1).max(43_200).default(240),
    graceMinutes: minutes(1440).default(5),
    quietHours: z.object({ start: hhmm, end: hhmm }).optional(),
    /** Optional warning N minutes before a required deadline. */
    warnBeforeMinutes: z.number().int().min(5).max(1440).optional(),
    onSuccess: ConsequenceListSchema,
    onOutside: ConsequenceListSchema,
    onMissed: ConsequenceListSchema,
    onOutsideDuringWindow: ConsequenceListSchema,
    windowCooldownMinutes: minutes(10_080).default(60),
  })
  .default({});

const ForbiddenRuleSchema = z
  .object({
    enabled: z.boolean().default(false),
    firstWarningAfterMinutes: nullableMinutes(1440).default(2),
    firstPenaltyAfterMinutes: minutes(1440).default(10),
    repeatEveryMinutes: z.number().int().min(5).max(10_080).default(5),
    repeatWarningAfterMinutes: nullableMinutes(10_080).default(1),
    onEnter: ConsequenceListSchema,
  })
  .default({});

const RewardRuleSchema = z
  .object({
    enabled: z.boolean().default(false),
    cooldownMinutes: minutes(10_080).default(720),
    /** Overall cap per day across all reward zones (zones may have their own, lower caps). */
    maxPerDay: z.number().int().min(1).max(100).default(1),
    /** Minutes of continuous presence required before the reward (0 = immediately). */
    dwellMinutes: minutes(1440).default(0),
    onEnter: ConsequenceListSchema,
  })
  .default({});

export const TrackingSchema = z
  .object({
    enabled: z.boolean().default(false),
    heartbeatMinutes: z.number().int().min(15).max(10_080).default(20),
    onHeartbeatMissed: ConsequenceListSchema,
    maxDelayMinutes: z.number().int().min(1).max(10_080).default(1440),
    countsAsCheckin: z.boolean().default(true),
    /** F16 – live tracking only: manual check-ins are disabled, every rule runs on background updates. */
    liveOnly: z.boolean().default(false),
    /** OwnTracks monitoring mode provisioned on pairing. `auto` → move if heartbeat < 60 min or forbidden zones exist. */
    owntracksMode: z.enum(['auto', 'move', 'significant']).default('auto'),
    /** No missing-signal penalties or warnings during these hours. */
    quietHours: z.object({ start: hhmm, end: hhmm }).optional(),
    /** Warn the wearer N minutes before a missing-signal penalty (10 ≤ N < heartbeatMinutes). */
    warnBeforeMinutes: z.number().int().min(10).max(10_079).optional(),
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
    /** `all` = hint + all checkpoints pinned on the map (wrong guesses are disabled). */
    reveal: z.enum(['all', 'hint', 'distance', 'map']).default('all'),
    order: z.enum(['sequence', 'any']).default('sequence'),
    wrongCooldownMinutes: minutes(1440).default(10),
    timeLimitMinutes: z.number().int().min(10).max(525_600).optional(),
    blockUnlockUntilComplete: z.boolean().default(false),
    /** How the hunt starts: with the lock, by the wearer, by the keyholder, or at a scheduled time. Keyholder can always force-start. */
    start: z.enum(['auto', 'wearer', 'keyholder', 'scheduled']).default('auto'),
    /** Scheduled start: absolute time (ISO) … */
    startAt: z.string().max(40).optional(),
    /** … or minutes after the lock started. */
    startAfterMinutes: z.number().int().min(0).max(525_600).optional(),
    /** Who may pause and resume a running hunt. A pause stops the time limit; checkpoints don't count while paused. */
    pauseBy: z.enum(['nobody', 'keyholder', 'both']).default('keyholder'),
    /** The wearer may abort the hunt (counts as failed and applies `onAbort`). The keyholder can always abort without consequences. */
    wearerCanAbort: z.boolean().default(false),
    onAbort: ConsequenceListSchema,
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
    /** Live-tracking-only locks: request a verification picture at random, on average every N hours. */
    liveVerificationEveryHours: z.number().int().min(1).max(168).optional(),
  })
  .default({});
export type AntiCheat = z.infer<typeof AntiCheatSchema>;

export const PrivacySchema = z
  .object({ coordinates: z.enum(['zone_only', 'exact']).default('zone_only') })
  .default({});
export type CoordinatePrivacy = 'zone_only' | 'exact';

/** Keyholder notification switches (ntfy). */
export const KeyholderNotifySchema = z
  .object({
    penalty: z.boolean().default(true),
    forbiddenEntered: z.boolean().default(true),
    tracking: z.boolean().default(true),
    requiredMissed: z.boolean().default(true),
    requiredDone: z.boolean().default(false),
    hunt: z.boolean().default(true),
    reward: z.boolean().default(false),
    verification: z.boolean().default(true),
  })
  .default({});
export type KeyholderNotifyKind = keyof z.infer<typeof KeyholderNotifySchema>;

export const LockationConfigSchema = z
  .object({
    version: z.literal(CONFIG_VERSION).default(CONFIG_VERSION),
    timezone: z.string().min(1).max(64).default('UTC'),
    matchMode: MatchModeSchema.default('lenient'),
    zones: z.array(ZoneSchema).max(MAX_PLACES).default([]),
    rules: z
      .object({
        required: RequiredRuleSchema,
        forbidden: ForbiddenRuleSchema,
        reward: RewardRuleSchema,
        travel: TravelRuleSchema,
        hunt: HuntRuleSchema,
      })
      .default({}),
    tracking: TrackingSchema,
    antiCheat: AntiCheatSchema,
    privacy: PrivacySchema,
    notifications: z.object({ keyholder: KeyholderNotifySchema }).default({}),
    /** Keyholder accepted the disclaimer (checked on save, not on read – old configs stay readable). */
    disclaimer: z.object({ version: z.number().int().min(1), acceptedAt: z.string().max(40) }).optional(),
  })
  .superRefine((cfg, ctx) => {
    const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: 'custom', path, message });
    const places = cfg.zones.length + cfg.rules.hunt.checkpoints.length;
    if (places > MAX_PLACES) issue(['zones'], `at most ${MAX_PLACES} zones and hunt checkpoints in total (currently ${places})`);
    if (!isValidTimezone(cfg.timezone)) issue(['timezone'], `unknown timezone "${cfg.timezone}"`);

    const ids = new Set<string>();
    cfg.zones.forEach((z, i) => {
      if (ids.has(z.id)) issue(['zones', i, 'id'], `duplicate zone id "${z.id}"`);
      ids.add(z.id);
      if (new Set(z.roles).size !== z.roles.length) issue(['zones', i, 'roles'], 'duplicate role');
      if (z.roles.includes('forbidden') && z.roles.length > 1) issue(['zones', i, 'roles'], 'a forbidden zone cannot have other roles');
      const f = forbiddenTimings(cfg, z);
      const ownTimings = ['firstWarningAfterMinutes', 'firstPenaltyAfterMinutes', 'repeatEveryMinutes', 'repeatWarningAfterMinutes'].some((k) => z.forbidden[k as keyof typeof z.forbidden] !== undefined);
      // Inherited timings are validated once at rule level; only zones with own values report here.
      if (z.roles.includes('forbidden') && ownTimings) {
        if (f.firstWarning !== null && f.firstWarning >= f.firstPenalty) {
          issue(['zones', i, 'forbidden', 'firstWarningAfterMinutes'], 'the first warning must come before the first penalty');
        }
        if (f.repeatWarning !== null && f.repeatWarning >= f.repeatEvery) {
          issue(['zones', i, 'forbidden', 'repeatWarningAfterMinutes'], 'the repeat warning must come before the next penalty');
        }
      }
      if (z.roles.includes('required') && z.required.stayWindows.length && !cfg.tracking.enabled) {
        issue(['zones', i, 'required', 'stayWindows'], '"must stay inside" windows need background tracking to be enabled');
      }
    });

    const R = cfg.rules;
    const withRole = (r: ZoneRole) => cfg.zones.filter((z) => z.roles.includes(r));
    if (R.required.enabled && !R.required.anywhere && withRole('required').length === 0) {
      issue(['rules', 'required', 'enabled'], 'mark at least one zone as required, or require check-ins anywhere');
    }
    if (R.forbidden.enabled && withRole('forbidden').length === 0) issue(['rules', 'forbidden', 'enabled'], 'mark at least one zone as forbidden');
    if (R.reward.enabled && withRole('reward').length === 0) issue(['rules', 'reward', 'enabled'], 'mark at least one zone as reward zone');
    if (R.forbidden.firstWarningAfterMinutes !== null && R.forbidden.firstWarningAfterMinutes >= R.forbidden.firstPenaltyAfterMinutes) {
      issue(['rules', 'forbidden', 'firstWarningAfterMinutes'], 'the first warning must come before the first penalty');
    }
    if (R.forbidden.repeatWarningAfterMinutes !== null && R.forbidden.repeatWarningAfterMinutes >= R.forbidden.repeatEveryMinutes) {
      issue(['rules', 'forbidden', 'repeatWarningAfterMinutes'], 'the repeat warning must come before the next penalty');
    }
    // Interval minimum: 1 min when background locations count as check-ins (automatic), else 5 min (manual check-ins).
    const minInterval = minRequiredInterval(cfg);
    if (R.required.intervalMinutes < minInterval) {
      issue(['rules', 'required', 'intervalMinutes'], `at least ${minInterval} min ${minInterval === 1 ? '' : '(1 min with background tracking counting as check-ins)'}`.trim());
    }
    cfg.zones.forEach((z, i) => {
      const v = z.required.intervalMinutes;
      if (z.roles.includes('required') && v !== undefined && v < minInterval) issue(['zones', i, 'required', 'intervalMinutes'], `at least ${minInterval} min`);
    });
    if (R.required.warnBeforeMinutes !== undefined && R.required.warnBeforeMinutes >= R.required.intervalMinutes) {
      issue(['rules', 'required', 'warnBeforeMinutes'], 'the warning must be shorter than the check-in interval');
    }
    const tr = cfg.tracking;
    if (tr.liveOnly && !tr.enabled) issue(['tracking', 'liveOnly'], 'live tracking only needs background tracking to be enabled');
    if (tr.warnBeforeMinutes !== undefined && tr.warnBeforeMinutes >= tr.heartbeatMinutes) {
      issue(['tracking', 'warnBeforeMinutes'], 'the warning must come before the missing-signal penalty');
    }
    if (cfg.antiCheat.liveVerificationEveryHours !== undefined && !tr.liveOnly) {
      issue(['antiCheat', 'liveVerificationEveryHours'], 'random verification pictures need "live tracking only"');
    }
    if (R.hunt.enabled && R.hunt.checkpoints.length === 0) issue(['rules', 'hunt', 'checkpoints'], 'add at least one checkpoint');
    if (R.hunt.start === 'scheduled' && !R.hunt.startAt && R.hunt.startAfterMinutes === undefined) {
      issue(['rules', 'hunt', 'startAt'], 'set a start time or a delay after the lock start');
    }
    if (R.hunt.startAt !== undefined && !Number.isFinite(Date.parse(R.hunt.startAt))) issue(['rules', 'hunt', 'startAt'], 'invalid date/time');
    const cpIds = new Set<string>();
    R.hunt.checkpoints.forEach((c, i) => {
      if (cpIds.has(c.id)) issue(['rules', 'hunt', 'checkpoints', i, 'id'], `duplicate checkpoint id "${c.id}"`);
      cpIds.add(c.id);
    });
  });

export type LockationConfig = z.infer<typeof LockationConfigSchema>;
export type LockationConfigInput = z.input<typeof LockationConfigSchema>;
export type HuntReveal = LockationConfig['rules']['hunt']['reveal'];

/** Bump when the disclaimer text changes materially – keyholders must accept again on the next save. */
export const DISCLAIMER_VERSION = 1;

export function disclaimerAccepted(config: Pick<LockationConfig, 'disclaimer'>): boolean {
  return (config.disclaimer?.version ?? 0) >= DISCLAIMER_VERSION;
}

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

/** Parse unknown input (from Chaster or the config page) into a full v2 config. v1 input is migrated first. */
export function parseConfig(input: unknown): ParseConfigResult {
  const res = LockationConfigSchema.safeParse(migrateConfig(input ?? {}));
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

// ---------- helpers used by engine, view and UI ----------

/** Smallest allowed required interval: 1 min if background locations count as check-ins, otherwise 5 min (manual check-ins). */
export function minRequiredInterval(cfg: Pick<LockationConfig, 'tracking'>): number {
  const t = cfg.tracking;
  return t.enabled && (t.countsAsCheckin || t.liveOnly) ? 1 : 5;
}

export function zonesWithRole(cfg: LockationConfig, role: ZoneRole): Zone[] {
  return cfg.zones.filter((z) => z.roles.includes(role));
}

/** The role a zone effectively plays (its role list filtered by the enabled rules). */
export function activeRoles(cfg: LockationConfig, z: Zone): ZoneRole[] {
  return z.roles.filter((r) => cfg.rules[r].enabled);
}

export function matchModeOf(cfg: LockationConfig, place: { matchMode?: 'lenient' | 'strict' }): 'lenient' | 'strict' {
  return place.matchMode ?? cfg.matchMode;
}

export interface ForbiddenTimings {
  firstWarning: number | null;
  firstPenalty: number;
  repeatEvery: number;
  repeatWarning: number | null;
}

export function forbiddenTimings(cfg: LockationConfig, z: Zone): ForbiddenTimings {
  const r = cfg.rules.forbidden;
  const f = z.forbidden;
  return {
    firstWarning: f.firstWarningAfterMinutes === undefined ? r.firstWarningAfterMinutes : f.firstWarningAfterMinutes,
    firstPenalty: f.firstPenaltyAfterMinutes ?? r.firstPenaltyAfterMinutes,
    repeatEvery: f.repeatEveryMinutes ?? r.repeatEveryMinutes,
    repeatWarning: f.repeatWarningAfterMinutes === undefined ? r.repeatWarningAfterMinutes : f.repeatWarningAfterMinutes,
  };
}

/**
 * OwnTracks report interval (seconds, move mode): half the shortest required interval when background locations count as
 * check-ins (so a 1-minute deadline gets a report every 30 s), at most 300 s, at least 30 s.
 */
export function owntracksLocatorInterval(cfg: LockationConfig): number {
  const t = cfg.tracking;
  if (!t.enabled || !(t.countsAsCheckin || t.liveOnly) || !cfg.rules.required.enabled) return 300;
  const intervals = [
    ...(cfg.rules.required.anywhere || cfg.rules.required.combine === 'any' ? [cfg.rules.required.intervalMinutes] : []),
    ...zonesWithRole(cfg, 'required')
      .filter((z) => z.required.intervalCheckins)
      .map((z) => z.required.intervalMinutes ?? cfg.rules.required.intervalMinutes),
  ];
  if (!intervals.length) return 300;
  return Math.max(30, Math.min(300, Math.floor((Math.min(...intervals) * 60) / 2)));
}

/** Effective OwnTracks monitoring: 2 = move (frequent), 1 = significant (battery saving). */
export function owntracksMonitoring(cfg: LockationConfig): 1 | 2 {
  const m = cfg.tracking.owntracksMode;
  if (m === 'move') return 2;
  if (m === 'significant') return 1;
  const forbidden = cfg.rules.forbidden.enabled && zonesWithRole(cfg, 'forbidden').length > 0;
  return cfg.tracking.heartbeatMinutes < 60 || forbidden || owntracksLocatorInterval(cfg) < 300 ? 2 : 1;
}

// ---------- v1 → v2 migration ----------

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const strs = (v: unknown): string[] => arr(v).filter((x): x is string => typeof x === 'string');

/**
 * Converts a v1 config (zone lists per rule, curfew rule, single forbidden cooldown) to the v2 shape.
 * v2 input is returned unchanged. The result is still validated by the schema afterwards.
 *
 * Behaviour-preserving choices:
 * - roles come from the rule zone lists; a zone listed as both required and forbidden keeps `forbidden`;
 * - required: `anywhere` = enabled without zones; several required zones → `combine: "any"` (one shared deadline);
 *   a missing grace period gets the v1 default (15 min);
 * - forbidden: first penalty after `tracking.entryConfirmMinutes` (v1 default 3), repeat every `cooldownMinutes`
 *   (min. 5), no warnings;
 * - curfew → "must stay inside" windows of the curfew zones (required role, no interval check-ins unless the zone was
 *   already required), curfew consequences/cooldown → `onOutsideDuringWindow` / `windowCooldownMinutes`;
 * - hunt reveal default stays `distance` (v1 default).
 */
export function migrateConfig(input: unknown): unknown {
  if (!isObj(input)) return input;
  if (input.version === CONFIG_VERSION) return input;
  if (input.version !== undefined && input.version !== 1) return input; // let the schema report it

  const rules: Obj = isObj(input.rules) ? input.rules : {};
  const req: Obj = isObj(rules.required) ? rules.required : {};
  const forb: Obj = isObj(rules.forbidden) ? rules.forbidden : {};
  const rew: Obj = isObj(rules.reward) ? rules.reward : {};
  const cur: Obj = isObj(rules.curfew) ? rules.curfew : {};
  const hunt: Obj = isObj(rules.hunt) ? rules.hunt : {};
  const tracking: Obj = isObj(input.tracking) ? input.tracking : {};

  const reqIds = new Set(strs(req.zoneIds));
  const forbIds = new Set(strs(forb.zoneIds));
  const rewIds = new Set(strs(rew.zoneIds));
  const curfewOn = cur.enabled === true;
  const curIds = new Set(curfewOn ? strs(cur.zoneIds) : []);

  const zones = arr(input.zones).map((raw) => {
    if (!isObj(raw)) return raw;
    const zid = String(raw.id);
    const roles: string[] = [];
    if (forbIds.has(zid)) roles.push('forbidden');
    else {
      if (reqIds.has(zid) || curIds.has(zid)) roles.push('required');
      if (rewIds.has(zid)) roles.push('reward');
    }
    const z: Obj = { ...raw, roles };
    if (roles.includes('required') && curIds.has(zid)) {
      z.required = {
        intervalCheckins: reqIds.has(zid) && req.enabled !== false,
        stayWindows: [{ start: cur.start ?? '22:00', end: cur.end ?? '06:00' }],
      };
    }
    return z;
  });

  const reqZoneCount = [...reqIds].filter((zid) => !forbIds.has(zid)).length;
  const reqEnabled = req.enabled === true;
  const { zoneIds: _rz, ...reqRest } = req;
  const required: Obj = {
    ...reqRest,
    enabled: reqEnabled || curfewOn,
    anywhere: reqEnabled && reqIds.size === 0,
    combine: reqZoneCount > 1 ? 'any' : 'each',
    graceMinutes: req.graceMinutes ?? 15,
  };
  if (curfewOn) {
    required.onOutsideDuringWindow = cur.onOutside ?? [];
    required.windowCooldownMinutes = cur.cooldownMinutes ?? 60;
  }

  const cooldown = typeof forb.cooldownMinutes === 'number' ? forb.cooldownMinutes : 60;
  const confirm = typeof tracking.entryConfirmMinutes === 'number' ? tracking.entryConfirmMinutes : 3;
  const forbidden: Obj = {
    enabled: forb.enabled === true,
    onEnter: forb.onEnter ?? [],
    firstWarningAfterMinutes: null,
    repeatWarningAfterMinutes: null,
    firstPenaltyAfterMinutes: Math.max(0, confirm),
    repeatEveryMinutes: Math.max(5, cooldown),
  };
  const { zoneIds: _wz, ...rewRest } = rew;
  const { entryConfirmMinutes: _ec, ...trackingRest } = tracking;

  return {
    ...input,
    version: CONFIG_VERSION,
    zones,
    rules: {
      ...rules,
      required,
      forbidden,
      reward: rewRest,
      hunt: { reveal: 'distance', ...hunt },
      curfew: undefined,
    },
    tracking: trackingRest,
  };
}
