/**
 * TEST FIXTURES ONLY. Many older tests describe configs in the compact pre-v2 shape (zone lists per rule, curfew rule,
 * single forbidden cooldown). This converts such fixtures to the current shape. The product has no v1 support.
 */
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const strs = (v: unknown): string[] => arr(v).filter((x): x is string => typeof x === 'string');

export function fromCompactFixture(input: Obj): Obj {
  if (input.version === 2) return input;

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
  const reqEnabled = req.enabled === true;
  const { zoneIds: _rz, ...reqRest } = req;
  const required: Obj = {
    ...reqRest,
    enabled: reqEnabled || curfewOn,
    anywhere: reqEnabled && reqIds.size === 0,
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
  const { entryConfirmMinutes: _ec, liveOnly, countsAsCheckin: _cc, ...trackingRest } = tracking;
  if (liveOnly === true) (trackingRest as Obj).checkins = 'auto';

  return {
    ...input,
    version: 2,
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
