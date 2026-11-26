/**
 * Lock configuration schema (stored as the Chaster extension `config`).
 *
 * Version 2: zones carry roles (required and/or reward, or forbidden, or neutral) and per-zone settings; required zones
 * can have "must stay inside" windows; forbidden zones escalate with warnings. (Version 1 was dropped before the beta –
 * there is no migration.)
 */
import { z } from 'zod';
import { ToyEffectSchema } from './toys.js';
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
export const ZoneRoleSchema = z.enum(['required', 'reward', 'forbidden', 'surprise']);
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

/**
 * F26 – one possible outcome of a surprise zone. On entering, one outcome is drawn (by weight). It may hold the wearer
 * inside: `stay` = released after `holdMinutes`, `keyholder` = released by the keyholder (at the latest after `holdMinutes`).
 */
export const SurpriseOutcomeSchema = z.object({
  id,
  /** Shown to the wearer when it happens, e.g. "Treasure!" or "Trap – stay 20 minutes". */
  label: z.string().min(1).max(80),
  weight: z.number().int().min(1).max(100).default(1),
  onEnter: ConsequenceListSchema,
  hold: z.enum(['none', 'stay', 'keyholder']).default('none'),
  holdMinutes: z.number().int().min(1).max(1440).optional(),
  onReleased: ConsequenceListSchema,
  onEarlyLeave: ConsequenceListSchema,
});
export type SurpriseOutcome = z.infer<typeof SurpriseOutcomeSchema>;

const ZoneSurpriseSchema = z
  .object({
    /** `once`: only the first visit counts; `repeat`: every visit after the cooldown draws again. */
    visits: z.enum(['once', 'repeat']).default('once'),
    cooldownMinutes: minutes(10_080).default(60),
    outcomes: z.array(SurpriseOutcomeSchema).max(10).default([]),
  })
  .default({});

/** Actions when entering / leaving a zone – independent of the zone's role (neutral zones too). */
const ZoneActionsSchema = z
  .object({
    onEnter: ConsequenceListSchema,
    onLeave: ConsequenceListSchema,
    /** "On leave" only after at least this long inside (e.g. 45 min at the gym). */
    minStayMinutes: minutes(1440).default(0),
    /** Minimum time between two runs of the same action. */
    cooldownMinutes: minutes(10_080).default(0),
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
  surprise: ZoneSurpriseSchema,
  /** F27 – a toy effect that runs while the wearer is inside this zone. */
  toy: z.object({ whileInside: ToyEffectSchema.optional() }).default({}),
  actions: ZoneActionsSchema,
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
    /**
     * How check-ins happen when tracking is on: `both` = manual check-ins and background locations count (default),
     * `auto` = background locations only (manual check-ins disabled). Manual check-ins only = tracking disabled.
     */
    checkins: z.enum(['both', 'auto']).default('both'),
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
    /**
     * Random route: when the hunt starts, between `min` and `max` of the checkpoints (the pool) are drawn in random order.
     * Nobody knows the route in advance – this makes hunts possible on self-locks.
     */
    random: z
      .object({ enabled: z.boolean().default(false), min: z.number().int().min(1).max(MAX_PLACES).default(2), max: z.number().int().min(1).max(MAX_PLACES).default(4) })
      .default({}),
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

/**
 * F25 – surprise missions: "be at zone X within N minutes". Targets are never forbidden zones. Random missions come on
 * average every `everyMinutes` (±50 %) and only within the active hours; the keyholder can also send one by hand.
 */
export const MissionRuleSchema = z
  .object({
    enabled: z.boolean().default(false),
    /** Possible target zones (ids). Empty = every zone that is not forbidden. */
    zoneIds: z.array(z.string()).max(MAX_PLACES).default([]),
    /** Time to get there. */
    leadMinutes: z.number().int().min(5).max(720).default(45),
    random: z
      .object({
        enabled: z.boolean().default(true),
        everyMinutes: z.number().int().min(5).max(10_080).default(240),
        /** Random missions only start within these hours (lock timezone). Same start and end = all day. */
        activeHours: z.object({ start: hhmm, end: hhmm }).default({ start: '09:00', end: '21:00' }),
      })
      .default({}),
    /** Zones closer than this to the last known position are not picked for random missions. */
    minDistanceM: z.number().int().min(0).max(100_000).default(300),
    keyholderCanSend: z.boolean().default(true),
    /** Missions the wearer may decline per day without penalty ("can't right now"). */
    declinesPerDay: z.number().int().min(0).max(10).default(1),
    /** Reminder before the mission ends (0 = none). */
    warnBeforeMinutes: z.number().int().min(0).max(120).default(10),
    onSuccess: ConsequenceListSchema,
    onFail: ConsequenceListSchema,
  })
  .default({});

/** F27 – toy control via XToys: toy consequences need it enabled; the wearer's emergency stop can be punished. */
export const ToyRuleSchema = z
  .object({
    enabled: z.boolean().default(false),
    /** Applied when the wearer disconnects the toys (emergency stop). Optional (empty = free). */
    onEmergencyStop: ConsequenceListSchema,
    /** Runs while the wearer is outside all required zones. Needs background tracking. */
    whileOutsideRequired: ToyEffectSchema.optional(),
  })
  .default({});

/** F26 – surprise zones (per-zone outcomes live in `zone.surprise`). */
export const SurpriseRuleSchema = z
  .object({
    enabled: z.boolean().default(false),
    /** Show the wearer the possible outcomes of each zone (not which one comes). */
    showPossible: z.boolean().default(false),
  })
  .default({});

/** Keyholder notification switches (ntfy). */
export const KeyholderNotifySchema = z
  .object({
    penalty: z.boolean().default(true),
    forbiddenEntered: z.boolean().default(true),
    tracking: z.boolean().default(true),
    requiredMissed: z.boolean().default(true),
    requiredDone: z.boolean().default(false),
    hunt: z.boolean().default(true),
    mission: z.boolean().default(true),
    surprise: z.boolean().default(true),
    toys: z.boolean().default(true),
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
        mission: MissionRuleSchema,
        surprise: SurpriseRuleSchema,
        toy: ToyRuleSchema,
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
      if (z.roles.includes('surprise') && z.roles.length > 1) issue(['zones', i, 'roles'], 'a surprise zone cannot have other roles');
      if (z.roles.includes('surprise') && cfg.rules.surprise.enabled) {
        if (!z.surprise.outcomes.length) issue(['zones', i, 'surprise', 'outcomes'], `add at least one possible outcome to "${z.name}"`);
        z.surprise.outcomes.forEach((o, j) => {
          if (o.hold !== 'none' && !o.holdMinutes) issue(['zones', i, 'surprise', 'outcomes', j, 'holdMinutes'], o.hold === 'stay' ? 'how long must the wearer stay?' : 'set the latest release time (needed e.g. on self-locks)');
        });
      }
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
      if (z.toy.whileInside && cfg.rules.toy.enabled && !cfg.tracking.enabled) {
        issue(['zones', i, 'toy', 'whileInside'], '"while inside" toy effects need background tracking to notice when the wearer leaves');
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
    if (R.surprise.enabled && withRole('surprise').length === 0) issue(['rules', 'surprise', 'enabled'], 'mark at least one zone as surprise zone');
    if (R.forbidden.firstWarningAfterMinutes !== null && R.forbidden.firstWarningAfterMinutes >= R.forbidden.firstPenaltyAfterMinutes) {
      issue(['rules', 'forbidden', 'firstWarningAfterMinutes'], 'the first warning must come before the first penalty');
    }
    if (R.forbidden.repeatWarningAfterMinutes !== null && R.forbidden.repeatWarningAfterMinutes >= R.forbidden.repeatEveryMinutes) {
      issue(['rules', 'forbidden', 'repeatWarningAfterMinutes'], 'the repeat warning must come before the next penalty');
    }
    // Interval minimum: 1 min when background locations count as check-ins (automatic), else 5 min (manual check-ins).
    const minInterval = minRequiredInterval(cfg);
    if (R.required.intervalMinutes < minInterval) {
      issue(['rules', 'required', 'intervalMinutes'], `at least ${minInterval} min${minInterval === 3 ? '' : ' (3 min when background locations count as check-ins)'}`);
    }
    cfg.zones.forEach((z, i) => {
      const v = z.required.intervalMinutes;
      if (z.roles.includes('required') && v !== undefined && v < minInterval) issue(['zones', i, 'required', 'intervalMinutes'], `at least ${minInterval} min`);
    });
    if (R.required.warnBeforeMinutes !== undefined && R.required.warnBeforeMinutes >= R.required.intervalMinutes) {
      issue(['rules', 'required', 'warnBeforeMinutes'], 'the warning must be shorter than the check-in interval');
    }
    const tr = cfg.tracking;
    if (tr.warnBeforeMinutes !== undefined && tr.warnBeforeMinutes >= tr.heartbeatMinutes) {
      issue(['tracking', 'warnBeforeMinutes'], 'the warning must come before the missing-signal penalty');
    }
    if (cfg.antiCheat.liveVerificationEveryHours !== undefined && !(tr.enabled && tr.checkins === 'auto')) {
      issue(['antiCheat', 'liveVerificationEveryHours'], 'random verification pictures need "live tracking only"');
    }
    if (R.hunt.enabled && R.hunt.checkpoints.length === 0) issue(['rules', 'hunt', 'checkpoints'], 'add at least one checkpoint');
    if (R.toy.enabled) {
      if (R.toy.onEmergencyStop.some((c) => c.type === 'toy')) issue(['rules', 'toy', 'onEmergencyStop'], 'the emergency stop cannot trigger toy actions');
      if (R.toy.whileOutsideRequired && !cfg.tracking.enabled) issue(['rules', 'toy', 'whileOutsideRequired'], 'needs background tracking to notice where the wearer is');
      if (R.toy.whileOutsideRequired && !withRole('required').length) issue(['rules', 'toy', 'whileOutsideRequired'], 'mark at least one zone as required');
    }
    const M = R.mission;
    if (M.enabled) {
      M.zoneIds.forEach((id, i) => {
        const z = cfg.zones.find((x) => x.id === id);
        if (!z) issue(['rules', 'mission', 'zoneIds', i], `unknown zone "${id}"`);
        else if (z.roles.includes('forbidden')) issue(['rules', 'mission', 'zoneIds', i], `"${z.name}" is forbidden and cannot be a mission target`);
      });
      if (!missionTargets(cfg).length) issue(['rules', 'mission', 'enabled'], 'add at least one zone that is not forbidden as a mission target');
      if (!M.random.enabled && !M.keyholderCanSend) issue(['rules', 'mission', 'random', 'enabled'], 'enable random missions or let the keyholder send missions');
      if (M.warnBeforeMinutes >= M.leadMinutes) issue(['rules', 'mission', 'warnBeforeMinutes'], 'the reminder must come before the mission ends');
    }
    const rnd = R.hunt.random;
    if (rnd.enabled) {
      if (rnd.min > rnd.max) issue(['rules', 'hunt', 'random', 'min'], 'the minimum cannot be larger than the maximum');
      if (R.hunt.enabled && rnd.max > R.hunt.checkpoints.length) {
        issue(['rules', 'hunt', 'random', 'max'], `add at least ${rnd.max} possible checkpoints (currently ${R.hunt.checkpoints.length}) or lower the maximum`);
      }
    }
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

// ---------- helpers used by engine, view and UI ----------

/** Background locations count as required check-ins (whenever tracking is on). */
export function backgroundCounts(cfg: Pick<LockationConfig, 'tracking'>): boolean {
  return cfg.tracking.enabled;
}

/** Smallest allowed required interval: 3 min if background locations count as check-ins, otherwise 5 min (manual check-ins). */
export function minRequiredInterval(cfg: Pick<LockationConfig, 'tracking'>): number {
  return backgroundCounts(cfg) ? 3 : 5;
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
 * check-ins, between 120 s (every 2 min – e.g. for a 3-minute interval) and 300 s.
 */
export function owntracksLocatorInterval(cfg: LockationConfig): number {
  if (!backgroundCounts(cfg) || !cfg.rules.required.enabled) return 300;
  const intervals = [
    ...(cfg.rules.required.anywhere ? [cfg.rules.required.intervalMinutes] : []),
    ...zonesWithRole(cfg, 'required')
      .filter((z) => z.required.intervalCheckins)
      .map((z) => z.required.intervalMinutes ?? cfg.rules.required.intervalMinutes),
  ];
  if (!intervals.length) return 300;
  return Math.max(120, Math.min(300, Math.floor((Math.min(...intervals) * 60) / 2)));
}

/** Effective OwnTracks monitoring: 2 = move (frequent), 1 = significant (battery saving). */
export function owntracksMonitoring(cfg: LockationConfig): 1 | 2 {
  const m = cfg.tracking.owntracksMode;
  if (m === 'move') return 2;
  if (m === 'significant') return 1;
  const forbidden = cfg.rules.forbidden.enabled && zonesWithRole(cfg, 'forbidden').length > 0;
  return cfg.tracking.heartbeatMinutes < 60 || forbidden || owntracksLocatorInterval(cfg) < 300 ? 2 : 1;
}

/** Zones a surprise mission may send the wearer to: the selected ones (or all), never forbidden zones. */
export function missionTargets(cfg: { zones: Zone[]; rules: { mission: { zoneIds: string[] } } }): Zone[] {
  const pick = cfg.rules.mission.zoneIds;
  return cfg.zones.filter((z) => !z.roles.includes('forbidden') && (!pick.length || pick.includes(z.id)));
}
