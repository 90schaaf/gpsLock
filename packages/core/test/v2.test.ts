import { describe, expect, it } from 'vitest';
import {
  activeWindowStart,
  utcToZonedWallTime,
  zonedWallTimeToUtc,
  allowedHuntActions,
  applyHuntAction,
  HuntActionError,
  allowedMissionActions,
  applyMissionAction,
  MissionActionError,
  missionDeclinesLeft,
  startRandomMissionNow,
  missionTargets,
  buildSessionView,
  diffConfig,
  evaluateCheckin,
  evaluateTick,
  evaluateTracked,
  initialState,
  nextDueAt,
  owntracksLocatorInterval,
  owntracksMonitoring,
  owntracksWaypoints,
  parseConfig,
  parseOwnTracks,
  type LockationConfig,
  type LockationState,
  type Notice,
  type TrackedInput,
} from '../src/index.js';
import { BAR, GYM, HOME, T0, cfg, fixAt, minutes, north, types } from './helpers.js';

const WORK = { lat: 47.36, lng: 8.53 };
const zone = (id: string, name: string, p: { lat: number; lng: number }, extra: Record<string, unknown> = {}) => ({ id, name, ...p, radiusM: 100, ...extra });
const tracking = { enabled: true, heartbeatMinutes: 120, onHeartbeatMissed: [{ type: 'add_time' as const, seconds: 1800 }] };

class Run {
  state: LockationState;
  n = 0;
  constructor(
    public config: LockationConfig,
    start = T0,
  ) {
    this.state = initialState(config, start);
  }
  track(input: TrackedInput, now: Date) {
    const r = evaluateTracked(this.config, this.state, input, { now, sessionId: 's1', evalId: `t${++this.n}` });
    this.state = r.state;
    return r;
  }
  at(p: { lat: number; lng: number }, at: Date, accuracy = 10) {
    return this.track({ fix: fixAt(p, at, accuracy) }, at);
  }
  checkin(p: { lat: number; lng: number }, at: Date, purpose: 'general' | 'hunt' = 'general') {
    const r = evaluateCheckin(this.config, this.state, fixAt(p, at), { now: at, sessionId: 's1', evalId: `c${++this.n}`, rng: () => 0.99 }, purpose);
    this.state = r.state;
    return r;
  }
  tick(at: Date) {
    const r = evaluateTick(this.config, this.state, { now: at, sessionId: 's1', evalId: `k${++this.n}`, rng: () => 0.5 });
    this.state = r.state;
    return r;
  }
}
const wearer = (ns: Notice[]) => ns.filter((n) => n.audience === 'wearer');
const kh = (ns: Notice[]) => ns.filter((n) => n.audience === 'keyholder');

describe('v2 validation', () => {
  const base = { version: 2, timezone: 'Europe/Zurich' };
  it('forbidden excludes other roles; stay windows need tracking; warnings before penalties', () => {
    expect(parseConfig({ ...base, zones: [zone('a', 'A', HOME, { roles: ['forbidden', 'reward'] })] }).ok).toBe(false);
    expect(parseConfig({ ...base, zones: [zone('a', 'A', HOME, { roles: ['required', 'reward'] })] }).ok).toBe(true);
    expect(parseConfig({ ...base, zones: [zone('a', 'A', HOME, { roles: ['required'], required: { stayWindows: [{ start: '22:00', end: '06:00' }] } })] }).ok).toBe(false);
    expect(parseConfig({ ...base, rules: { forbidden: { firstWarningAfterMinutes: 10, firstPenaltyAfterMinutes: 10 } } }).ok).toBe(false);
    expect(parseConfig({ ...base, rules: { forbidden: { repeatWarningAfterMinutes: 5, repeatEveryMinutes: 5 } } }).ok).toBe(false);
    expect(parseConfig({ ...base, rules: { forbidden: { enabled: true } } }).ok).toBe(false); // no forbidden zone
    expect(parseConfig({ ...base, tracking: { enabled: true, heartbeatMinutes: 20, warnBeforeMinutes: 20 } }).ok).toBe(false);
    expect(parseConfig({ ...base, antiCheat: { liveVerificationEveryHours: 4 } }).ok).toBe(false);
  });

  it('defaults: grace 5 min, forbidden 2/10/5/1, hunt reveal all in sequence', () => {
    const r = parseConfig(base);
    expect(r.ok && r.config.rules.required.graceMinutes).toBe(5);
    expect(r.ok && r.config.rules.forbidden).toMatchObject({ firstWarningAfterMinutes: 2, firstPenaltyAfterMinutes: 10, repeatEveryMinutes: 5, repeatWarningAfterMinutes: 1 });
    expect(r.ok && r.config.rules.hunt).toMatchObject({ reveal: 'all', order: 'sequence' });
  });
});

describe('time windows', () => {
  const tz = 'Europe/Zurich';
  it('handles midnight crossing and weekdays', () => {
    // 2026-06-05 is a Friday. 23:30 local = 21:30Z (CEST)
    const fri2330 = new Date('2026-06-05T21:30:00Z');
    const sat0130 = new Date('2026-06-05T23:30:00Z');
    const w = [{ start: '22:00', end: '02:00', days: ['fri' as const] }];
    expect(activeWindowStart(w, fri2330, tz)?.toISOString()).toBe('2026-06-05T20:00:00.000Z');
    expect(activeWindowStart(w, sat0130, tz)?.toISOString()).toBe('2026-06-05T20:00:00.000Z');
    expect(activeWindowStart(w, new Date('2026-06-06T21:30:00Z'), tz)).toBeUndefined(); // Saturday night
    expect(activeWindowStart([{ start: '08:00', end: '10:00' }], new Date('2026-06-05T09:00:00Z'), tz)).toBeUndefined(); // 11:00 local
  });
});

describe('required zones: each zone separately', () => {
  const config = () =>
    cfg({
      version: 2,
      zones: [
        zone('home', 'Home', HOME, { roles: ['required'], required: { intervalMinutes: 240, onMissed: [{ type: 'freeze' }] } }),
        zone('work', 'Work', WORK, { roles: ['required'], required: { intervalMinutes: 480 } }),
      ],
      rules: { required: { enabled: true, onMissed: [{ type: 'add_time', seconds: 3600 }], onOutside: [{ type: 'add_time', seconds: 60 }] } },
    });

  it('a check-in at Home does not reset Work; misses are per zone with extra punishment', () => {
    const r = new Run(config());
    expect(Object.keys(r.state.required.slots).sort()).toEqual(['home', 'work']);
    r.checkin(HOME, minutes(T0, 200));
    expect(r.state.required.slots.home!.nextDeadline).toBe(minutes(T0, 440).toISOString());
    expect(r.state.required.slots.work!.nextDeadline).toBe(minutes(T0, 480).toISOString());
    expect(types(r.tick(minutes(T0, 446)))).toEqual(['add_time', 'freeze']); // home 440 + grace 5: rule list + zone extra
    const miss = r.tick(minutes(T0, 486)); // work 480 + grace 5: rule list only
    expect(types(miss)).toEqual(['add_time']);
    expect(kh(miss.notices).map((n) => n.kind)).toContain('requiredMissed');
    const r2 = new Run(config());
    expect(types(r2.tick(minutes(T0, 246)))).toEqual(['add_time', 'freeze']); // home: rule list + zone extra
  });

  it('a check-in outside all required zones applies onOutside once', () => {
    const r = new Run(config());
    expect(types(r.checkin(BAR, minutes(T0, 10)))).toEqual(['add_time']);
  });

  it('warns before a deadline and never at/after it', () => {
    const c = config();
    c.rules.required.warnBeforeMinutes = 15;
    const r = new Run(c);
    expect(wearer(r.tick(minutes(T0, 220)).notices)).toHaveLength(0);
    const w = r.tick(minutes(T0, 226));
    expect(wearer(w.notices).map((n) => n.title)).toEqual(['Check-in due soon']);
    expect(wearer(r.tick(minutes(T0, 230)).notices)).toHaveLength(0); // once
    const late = new Run(c);
    expect(wearer(late.tick(minutes(T0, 241)).notices)).toHaveLength(0); // past the deadline → skipped
  });
});

describe('required zones: stay windows (former curfew)', () => {
  const night = new Date('2026-06-01T20:30:00Z'); // 22:30 Zurich
  const config = () =>
    cfg({
      version: 2,
      zones: [
        zone('home', 'Home', HOME, { roles: ['required'], required: { intervalCheckins: false, stayWindows: [{ start: '22:00', end: '06:00' }] } }),
        zone('partner', 'Partner', WORK, { roles: ['required'], required: { intervalCheckins: false, stayWindows: [{ start: '22:00', end: '06:00' }] } }),
      ],
      tracking,
      rules: { required: { enabled: true, windowCooldownMinutes: 30, onOutsideDuringWindow: [{ type: 'add_time', seconds: 3600 }] } },
    });

  it('outside all active zones → penalty with cooldown; inside any of them → fine', () => {
    const r = new Run(config());
    expect(Object.keys(r.state.required.slots)).toEqual([]);
    expect(types(r.at(BAR, night))).toEqual(['add_time']);
    expect(types(r.at(BAR, minutes(night, 10)))).toEqual([]);
    expect(types(r.at(BAR, minutes(night, 40)))).toEqual(['add_time']);
    const ok = new Run(config());
    expect(types(ok.at(WORK, night))).toEqual([]);
    expect(types(new Run(config()).at(BAR, new Date('2026-06-01T12:00:00Z')))).toEqual([]);
  });
});

describe('forbidden zones: escalation timeline', () => {
  const config = (extra: Record<string, unknown> = {}, ruleExtra: Record<string, unknown> = {}) =>
    cfg({
      version: 2,
      zones: [zone('bar', 'Bar', BAR, { roles: ['forbidden'], ...extra })],
      tracking,
      rules: { forbidden: { enabled: true, onEnter: [{ type: 'add_time', seconds: 3600 }], ...ruleExtra } },
    });

  it('default timeline: warn 2′, penalty 10′, warn 11′, penalty 15′ …', () => {
    const r = new Run(config());
    const t = (m: number) => minutes(T0, m);
    expect(r.at(BAR, t(0)).consequences).toHaveLength(0);
    const w0 = r.tick(t(2));
    expect(wearer(w0.notices).map((n) => n.key)).toEqual([`forbidden:bar:${T0.toISOString()}:warn:0`]);
    expect(kh(w0.notices).map((n) => n.kind)).toEqual(['forbiddenEntered']);
    expect(r.tick(t(5)).notices).toHaveLength(0);
    r.at(BAR, t(8));
    const p1 = r.tick(t(10));
    expect(types(p1)).toEqual(['add_time']);
    expect(kh(p1.notices).map((n) => n.kind)).toEqual(['penalty']);
    expect(wearer(r.tick(t(11)).notices)).toHaveLength(1); // repeat warning
    expect(types(r.tick(t(15)))).toEqual(['add_time']);
    expect(r.state.forbidden.visits.bar!.penalties).toBe(2);
  });

  it('leaving stops the timeline; re-entering within 5 min continues it, later starts a new visit', () => {
    const r = new Run(config());
    r.at(BAR, minutes(T0, 0));
    expect(types(r.at(BAR, minutes(T0, 11)))).toEqual(['add_time']); // penalty 1 at 10′
    expect(types(r.at(north(BAR, 600), minutes(T0, 12)))).toEqual([]); // left – only the stay up to 11′ is certain
    r.at(BAR, minutes(T0, 14));
    expect(r.state.forbidden.visits.bar!.since).toBe(T0.toISOString()); // re-entered within 5 min → continued
    r.at(north(BAR, 600), minutes(T0, 16));
    r.tick(minutes(T0, 30));
    expect(r.state.forbidden.visits.bar).toBeUndefined(); // reset after 5 min away
  });

  it('"when" schedules extra punishments per zone', () => {
    const r = new Run(config({ forbidden: { onEnter: [{ type: 'pillory', durationMinutes: 30, reason: 'bar', when: { everyNth: 2 } }, { type: 'freeze', when: { nth: 3 } }] } }, { firstWarningAfterMinutes: null, repeatWarningAfterMinutes: null }));
    r.at(BAR, T0);
    const all = [10, 15, 20, 25].map((m) => {
      r.at(BAR, minutes(T0, m - 1));
      return types(r.tick(minutes(T0, m)));
    });
    expect(all).toEqual([['add_time'], ['add_time', 'pillory'], ['add_time', 'freeze'], ['add_time', 'pillory']]);
  });

  it('without tracking a check-in inside is penalised immediately, repeated at most every 5 min', () => {
    const c = cfg({ version: 2, zones: [zone('bar', 'Bar', BAR, { roles: ['forbidden'] })], rules: { forbidden: { enabled: true, onEnter: [{ type: 'add_time', seconds: 60 }] } } });
    const r = new Run(c);
    expect(types(r.checkin(BAR, minutes(T0, 0)))).toEqual(['add_time']);
    expect(types(r.checkin(BAR, minutes(T0, 3)))).toEqual([]);
    expect(types(r.checkin(BAR, minutes(T0, 6)))).toEqual(['add_time']);
  });

  it('forbidden only during windows; a stay that started before counts from window start', () => {
    // window 20:00–02:00 Zurich = 18:00Z
    const r = new Run(config({ forbidden: { windows: [{ start: '20:00', end: '02:00' }] } }, { firstWarningAfterMinutes: null }));
    const before = new Date('2026-06-01T17:50:00Z');
    r.at(BAR, before);
    expect(r.state.forbidden.visits.bar).toBeUndefined();
    r.at(BAR, new Date('2026-06-01T18:05:00Z'));
    expect(r.state.forbidden.visits.bar!.since).toBe('2026-06-01T18:00:00.000Z');
    expect(types(r.tick(new Date('2026-06-01T18:10:00Z')))).toEqual(['add_time']);
  });

  it('nextDueAt points at the next warning / penalty', () => {
    const r = new Run(config());
    r.at(BAR, T0);
    expect(nextDueAt(r.config, r.state, T0)!.toISOString()).toBe(minutes(T0, 2).toISOString());
  });
});

describe('reward zones per zone', () => {
  it('zone caps and overall cap', () => {
    const c = cfg({
      version: 2,
      zones: [zone('gym', 'Gym', GYM, { roles: ['reward'], reward: { maxPerDay: 1, cooldownMinutes: 0 } }), zone('pool', 'Pool', WORK, { roles: ['reward'], reward: { cooldownMinutes: 0 } })],
      rules: { reward: { enabled: true, maxPerDay: 2, cooldownMinutes: 0, onEnter: [{ type: 'remove_time', seconds: 60 }] } },
    });
    const r = new Run(c);
    expect(types(r.checkin(GYM, minutes(T0, 0)))).toEqual(['remove_time']);
    expect(types(r.checkin(GYM, minutes(T0, 2)))).toEqual([]); // zone cap 1
    expect(types(r.checkin(WORK, minutes(T0, 4)))).toEqual(['remove_time']);
    expect(types(r.checkin(WORK, minutes(T0, 6)))).toEqual([]); // overall cap 2
  });
});

describe('hunt: reveal all, any order, OwnTracks sync', () => {
  const cps = [
    { id: 'c1', name: 'North', ...north(HOME, 500), radiusM: 60, hint: 'n' },
    { id: 'c2', name: 'Gym', ...GYM, radiusM: 60, hint: 'g' },
    { id: 'c3', name: 'Bar', ...BAR, radiusM: 60, hint: 'b' },
  ];
  const config = (hunt: Record<string, unknown>) => cfg({ version: 2, tracking, rules: { hunt: { enabled: true, checkpoints: cps, onCheckpoint: [{ type: 'remove_time', seconds: 60 }], onWrong: [{ type: 'add_time', seconds: 60 }], ...hunt } } });

  it('reveal all: every checkpoint visible with status, no wrong guesses', () => {
    const r = new Run(config({ reveal: 'all' }));
    const v = buildSessionView({ role: 'wearer', isSelfLock: true, config: r.config, state: r.state, history: [], now: T0 });
    expect(v.hunt!.checkpoints.map((c) => c.status)).toEqual(['current', 'upcoming', 'upcoming']);
    expect(v.hunt!.guessesAllowed).toBe(false);
    expect(types(r.checkin(HOME, minutes(T0, 1), 'hunt'))).toEqual([]);
  });

  it('any order: each unfound checkpoint counts; completes when all are found', () => {
    const r = new Run(config({ reveal: 'all', order: 'any', onComplete: [{ type: 'unfreeze' }] }));
    expect(types(r.at(BAR, minutes(T0, 10)))).toEqual(['remove_time']);
    expect(r.state.hunt.found).toEqual(['c3']);
    r.at(GYM, minutes(T0, 30));
    const last = r.at(north(HOME, 500), minutes(T0, 50));
    expect(types(last)).toEqual(['remove_time', 'unfreeze']);
    expect(r.state.hunt.status).toBe('completed');
  });

  it('waypoints contain only visible, unfound checkpoints; a checkpoint transition completes it', () => {
    const seq = new Run(config({ reveal: 'map' }));
    const w = owntracksWaypoints(seq.config, seq.state);
    expect(w.command.waypoints.waypoints.map((x) => x.desc)).toEqual(['Hunt 1: North']);
    const hidden = new Run(config({ reveal: 'distance' }));
    expect(owntracksWaypoints(hidden.config, hidden.state).command.waypoints.waypoints).toHaveLength(0);
    const input = parseOwnTracks({ _type: 'transition', event: 'enter', desc: 'Hunt 1: North', tst: Math.floor(minutes(T0, 5).getTime() / 1000) }, seq.config)!;
    expect(input.transition?.checkpointId).toBe('c1');
    expect(types(seq.track(input, minutes(T0, 5)))).toEqual(['remove_time']);
    expect(owntracksWaypoints(seq.config, seq.state).command.waypoints.waypoints.map((x) => x.desc)).toEqual(['Hunt 2: Gym']);
  });
});

describe('tracking: quiet hours, warning, mode, live verification', () => {
  it('missing-signal deadline inside quiet hours moves to their end + one period; no warning at night', () => {
    // quiet 23:00–07:00 Zurich; heartbeat 60 → start 22:30 local (20:30Z) → due 23:30 → moved to 07:00 + 60 = 08:00 local (06:00Z)
    const c = cfg({ version: 2, tracking: { ...tracking, heartbeatMinutes: 60, warnBeforeMinutes: 10, quietHours: { start: '23:00', end: '07:00' } } });
    const start = new Date('2026-06-01T20:30:00Z');
    const r = new Run(c, start);
    expect(r.state.tracking.nextHeartbeat).toBe('2026-06-02T06:00:00.000Z');
    expect(r.tick(new Date('2026-06-02T01:00:00Z')).consequences).toHaveLength(0);
    const warn = r.tick(new Date('2026-06-02T05:52:00Z'));
    expect(wearer(warn.notices).map((n) => n.title)).toEqual(['No location from your phone']);
    expect(types(r.tick(new Date('2026-06-02T06:00:00Z')))).toEqual(['add_time']);
  });

  it('auto mode: move with a short heartbeat or forbidden zones, otherwise significant', () => {
    expect(owntracksMonitoring(cfg({ version: 2, tracking: { enabled: true, heartbeatMinutes: 20 } }))).toBe(2);
    expect(owntracksMonitoring(cfg({ version: 2, tracking: { enabled: true, heartbeatMinutes: 180 } }))).toBe(1);
    expect(owntracksMonitoring(cfg({ version: 2, tracking: { enabled: true, heartbeatMinutes: 180, owntracksMode: 'move' } }))).toBe(2);
    expect(
      owntracksMonitoring(cfg({ version: 2, zones: [zone('bar', 'Bar', BAR, { roles: ['forbidden'] })], tracking: { enabled: true, heartbeatMinutes: 180 }, rules: { forbidden: { enabled: true } } })),
    ).toBe(2);
  });

  it('live-only: random verification picture on schedule', () => {
    const c = cfg({ version: 2, tracking: { ...tracking, checkins: 'auto' }, antiCheat: { liveVerificationEveryHours: 4 } });
    const r = new Run(c);
    r.tick(T0); // schedules: rng 0.5 → 4 h
    expect(r.state.nextLiveVerification).toBe(minutes(T0, 240).toISOString());
    expect(types(r.tick(minutes(T0, 241)))).toContain('verification_picture');
  });
});

describe('diffConfig', () => {
  it('summarises changes without revealing hidden checkpoints', () => {
    const a = cfg({ version: 2, zones: [zone('home', 'Home', HOME, { roles: ['required'] })], rules: { required: { enabled: true }, hunt: { enabled: true, reveal: 'hint', checkpoints: [{ id: 'c', name: 'Secret', ...BAR, radiusM: 50 }] } } });
    const b = cfg({
      version: 2,
      zones: [zone('home', 'Home', HOME, { roles: ['required'], required: { intervalMinutes: 120 } }), zone('casino', 'Casino', BAR, { roles: ['forbidden'] })],
      rules: { required: { enabled: true }, forbidden: { enabled: true }, hunt: { enabled: true, reveal: 'hint', checkpoints: [{ id: 'c', name: 'Secret', ...GYM, radiusM: 50 }] } },
    });
    const d = diffConfig(a, b);
    expect(d).toContain('Zone "Casino" added (forbidden, 100 m).');
    expect(d).toContain('"Home" check-in interval 4h → 2h.');
    expect(d).toContain('Forbidden zones enabled.');
    expect(d).toContain('Hunt checkpoints changed.');
    expect(d.join(' ')).not.toContain('Secret');
    expect(diffConfig(a, a)).toEqual([]);
  });
});

describe('"when" on missed lists', () => {
  it('applies every n-th / only the n-th missed check-in', () => {
    const c = cfg({
      version: 2,
      zones: [zone('home', 'Home', HOME, { roles: ['required'] })],
      rules: { required: { enabled: true, intervalMinutes: 60, graceMinutes: 0, onMissed: [{ type: 'add_time', seconds: 60 }, { type: 'freeze', when: { nth: 2 } }, { type: 'pillory', durationMinutes: 30, reason: 'x', when: { everyNth: 3 } }] } },
    });
    const r = new Run(c);
    const t = [61, 121, 181].map((m) => types(r.tick(minutes(T0, m))));
    expect(t).toEqual([['add_time'], ['add_time', 'freeze'], ['add_time', 'pillory']]);
  });
});

describe('tracking view: signal due time', () => {
  it('is last location + missing-signal time, respecting quiet hours', () => {
    const c = cfg({ version: 2, tracking: { ...tracking, heartbeatMinutes: 60, quietHours: { start: '23:00', end: '07:00' } } });
    const s = initialState(c, T0); // 12:00 Zurich
    s.tracking.deviceUser = 'u';
    s.tracking.lastSeenAt = minutes(T0, 30).toISOString();
    const v = (st: LockationState) => buildSessionView({ role: 'wearer', isSelfLock: true, config: c, state: st, history: [], now: T0 }).tracking!;
    expect(v(s).signalDueAt).toBe(minutes(T0, 90).toISOString());
    s.tracking.lastSeenAt = '2026-06-01T20:30:00.000Z'; // 22:30 Zurich → due 23:30 is quiet → 07:00 + 60 min = 06:00Z
    expect(v(s).signalDueAt).toBe('2026-06-02T06:00:00.000Z');
  });
});

describe('validation reports inherited forbidden timings only once', () => {
  it('rule-level issue only, unless the zone overrides timings', () => {
    const base = { version: 2, timezone: 'Europe/Zurich', zones: [zone('bar', 'Bar', BAR, { roles: ['forbidden'] })], rules: { forbidden: { enabled: true, firstWarningAfterMinutes: 30 } } };
    const r = parseConfig(base);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.map((i) => i.path)).toEqual(['rules.forbidden.firstWarningAfterMinutes']);
    const own = parseConfig({ ...base, rules: { forbidden: { enabled: true } }, zones: [zone('bar', 'Bar', BAR, { roles: ['forbidden'], forbidden: { firstWarningAfterMinutes: 30 } })] });
    if (!own.ok) expect(own.issues.map((i) => i.path)).toEqual(['zones.0.forbidden.firstWarningAfterMinutes']);
    expect(own.ok).toBe(false);
  });
});

describe('tracking setup is confirmed by a manual send', () => {
  it('stays waiting for automatic locations; a manual (t=u) location verifies it', () => {
    const c = cfg({ version: 2, tracking });
    const r = new Run(c);
    r.state.tracking.deviceUser = 'lo1';
    r.state.tracking.pairedAt = T0.toISOString();
    const auto = parseOwnTracks({ _type: 'location', lat: HOME.lat, lon: HOME.lng, acc: 10, tst: Math.floor(minutes(T0, 1).getTime() / 1000), t: 'p' }, c)!;
    expect(auto.manual).toBeUndefined();
    r.track(auto, minutes(T0, 1));
    const v = () => buildSessionView({ role: 'wearer', isSelfLock: false, config: c, state: r.state, history: [], now: minutes(T0, 2) }).tracking!;
    expect(v()).toMatchObject({ status: 'waiting', receiving: true });
    const manual = parseOwnTracks({ _type: 'location', lat: HOME.lat, lon: HOME.lng, acc: 10, tst: Math.floor(minutes(T0, 2).getTime() / 1000), t: 'u' }, c)!;
    const res = r.track(manual, minutes(T0, 2));
    expect(kh(res.notices).map((n) => n.title)).toEqual(['Lockation: tracking connected']);
    expect(v().status).toBe('connected');
  });
});

describe('hunt control', () => {
  const cps = [{ id: 'c1', name: 'North', ...north(HOME, 500), radiusM: 60, hint: 'n' }];
  const config = (hunt: Record<string, unknown>) => cfg({ version: 2, rules: { hunt: { enabled: true, checkpoints: cps, timeLimitMinutes: 60, onTimeout: [{ type: 'add_time', seconds: 60 }], onAbort: [{ type: 'add_time', seconds: 86400 }], ...hunt } } });
  const act = (r: Run, a: 'start' | 'pause' | 'resume' | 'abort', who: 'wearer' | 'keyholder', at: Date, self = false) => {
    const res = applyHuntAction(r.config, r.state, a, who, { now: at, sessionId: 's1', evalId: `h${++r.n}` }, self);
    r.state = res.state;
    return res;
  };

  it('wearer start mode: hidden until started; keyholder can force-start', () => {
    const r = new Run(config({ start: 'wearer' }));
    expect(r.state.hunt.status).toBe('not_started');
    expect(types(r.checkin(north(HOME, 500), minutes(T0, 1)))).toEqual([]); // doesn't count before the start
    expect(allowedHuntActions(r.config, r.state, 'wearer')).toEqual(['start']);
    act(r, 'start', 'wearer', minutes(T0, 5));
    expect(r.state.hunt).toMatchObject({ status: 'active', startedAt: minutes(T0, 5).toISOString() });
    const k = new Run(config({ start: 'keyholder' }));
    expect(allowedHuntActions(k.config, k.state, 'wearer')).toEqual([]);
    expect(() => act(k, 'start', 'wearer', T0)).toThrow(HuntActionError);
    expect(act(k, 'start', 'keyholder', T0).events[0]).toMatch(/started/);
  });

  it('scheduled start by the tick; pause stops the time limit', () => {
    const r = new Run(config({ start: 'scheduled', startAfterMinutes: 30 }));
    expect(nextDueAt(r.config, r.state, T0)!.toISOString()).toBe(minutes(T0, 30).toISOString());
    const s = r.tick(minutes(T0, 31));
    expect(r.state.hunt.status).toBe('active');
    expect(wearer(s.notices).map((n) => n.title)).toEqual(['Scavenger hunt started']);
    act(r, 'pause', 'keyholder', minutes(T0, 41));
    expect(() => act(r, 'resume', 'wearer', minutes(T0, 50))).toThrow(HuntActionError); // pauseBy keyholder
    expect(types(r.tick(minutes(T0, 100)))).toEqual([]); // no timeout while paused
    act(r, 'resume', 'keyholder', minutes(T0, 101)); // paused 60 min → deadline 31 + 60 + 60 = 151
    expect(types(r.tick(minutes(T0, 150)))).toEqual([]);
    expect(types(r.tick(minutes(T0, 152)))).toEqual(['add_time']);
  });

  it('abort: keyholder without consequences, wearer (if allowed) with onAbort', () => {
    const k = new Run(config({}));
    expect(types(act(k, 'abort', 'keyholder', minutes(T0, 5)))).toEqual([]);
    expect(k.state.hunt.status).toBe('aborted');
    const w = new Run(config({}));
    expect(allowedHuntActions(w.config, w.state, 'wearer')).not.toContain('abort');
    const w2 = new Run(config({ wearerCanAbort: true, pauseBy: 'both' }));
    expect(allowedHuntActions(w2.config, w2.state, 'wearer')).toEqual(['pause', 'abort']);
    const res = act(w2, 'abort', 'wearer', minutes(T0, 5));
    expect(types(res)).toEqual(['add_time']);
    expect(w2.state.hunt.status).toBe('failed');
    expect(kh(res.notices).map((n) => n.kind)).toContain('hunt');
  });

  it('self-lock: the wearer may start but has no penalty-free abort', () => {
    const r = new Run(config({ start: 'keyholder' }));
    expect(allowedHuntActions(r.config, r.state, 'wearer', true)).toEqual(['start']);
  });
});

describe('required interval minimum and OwnTracks report interval', () => {
  const req = (tr: Record<string, unknown>, interval: number) =>
    parseConfig({ version: 2, timezone: 'Europe/Zurich', zones: [zone('home', 'Home', HOME, { roles: ['required'] })], tracking: tr, rules: { required: { enabled: true, intervalMinutes: interval } } });
  it('3 min with background check-ins, 5 min with manual check-ins only', () => {
    expect(req({ enabled: true }, 3).ok).toBe(true);
    expect(req({ enabled: true }, 2).ok).toBe(false);
    expect(req({ enabled: false }, 4).ok).toBe(false);
    expect(req({ enabled: false }, 5).ok).toBe(true);
  });
  it('OwnTracks reports every half interval (120–300 s) and switches to move mode', () => {
    const c = cfg({ version: 2, zones: [zone('home', 'Home', HOME, { roles: ['required'] })], tracking: { enabled: true, heartbeatMinutes: 180 }, rules: { required: { enabled: true, intervalMinutes: 3 } } });
    expect(owntracksLocatorInterval(c)).toBe(120); // 3-min interval → report every 2 min
    expect(owntracksMonitoring(c)).toBe(2);
    const slow = cfg({ version: 2, zones: [zone('home', 'Home', HOME, { roles: ['required'] })], tracking: { enabled: true, heartbeatMinutes: 180 }, rules: { required: { enabled: true, intervalMinutes: 240 } } });
    expect(owntracksLocatorInterval(slow)).toBe(300);
    expect(owntracksMonitoring(slow)).toBe(1);
  });
});

describe('zone actions (enter / leave)', () => {
  const gym = (actions: Record<string, unknown>, tr: Record<string, unknown> = tracking) =>
    cfg({ version: 2, zones: [zone('gym', 'Gym', GYM, { actions })], tracking: tr });

  it('leave after a minimum stay unfreezes (background tracking, neutral zone)', () => {
    const r = new Run(gym({ onLeave: [{ type: 'unfreeze' }], minStayMinutes: 45 }));
    r.at(GYM, minutes(T0, 0));
    r.at(GYM, minutes(T0, 30));
    expect(types(r.at(north(GYM, 600), minutes(T0, 32)))).toEqual([]); // only 30 min provably inside
    r.at(GYM, minutes(T0, 40));
    r.at(GYM, minutes(T0, 90));
    const out = r.at(north(GYM, 600), minutes(T0, 92));
    expect(types(out)).toEqual(['unfreeze']);
    expect(out.events.join(' ')).toMatch(/Left "Gym" after 50 min/);
  });

  it('enter runs once per visit, with cooldown; works with manual check-ins', () => {
    const r = new Run(gym({ onEnter: [{ type: 'remove_time', seconds: 60 }], cooldownMinutes: 120 }, { enabled: false }));
    expect(types(r.checkin(GYM, minutes(T0, 0)))).toEqual(['remove_time']);
    expect(types(r.checkin(GYM, minutes(T0, 5)))).toEqual([]); // still inside
    r.checkin(north(GYM, 600), minutes(T0, 10));
    expect(types(r.checkin(GYM, minutes(T0, 20)))).toEqual([]); // cooldown
    r.checkin(north(GYM, 600), minutes(T0, 30));
    expect(types(r.checkin(GYM, minutes(T0, 130)))).toEqual(['remove_time']);
  });

  it('is summarised for the wearer and in config diffs', () => {
    const a = gym({});
    const b = gym({ onLeave: [{ type: 'unfreeze' }], minStayMinutes: 45 });
    const v = buildSessionView({ role: 'wearer', isSelfLock: true, config: b, state: initialState(b, T0), history: [], now: T0 });
    expect(v.rules.find((x) => x.rule === 'zoneActions')?.lines).toEqual(['Gym – leaving after at least 45min inside: unfreeze.']);
    expect(diffConfig(a, b)).toEqual(['"Gym" zone actions: entering nothing; leaving unfreeze (after 45min).']);
  });
});

describe('lock-timezone wall time conversion (scheduled hunt start)', () => {
  it('converts both ways, also across DST', () => {
    expect(zonedWallTimeToUtc('2026-06-01T18:30', 'Europe/Zurich')!.toISOString()).toBe('2026-06-01T16:30:00.000Z'); // CEST +2
    expect(zonedWallTimeToUtc('2026-12-01T18:30', 'Europe/Zurich')!.toISOString()).toBe('2026-12-01T17:30:00.000Z'); // CET +1
    expect(zonedWallTimeToUtc('2026-06-01T18:30', 'America/New_York')!.toISOString()).toBe('2026-06-01T22:30:00.000Z');
    expect(utcToZonedWallTime('2026-06-01T16:30:00.000Z', 'Europe/Zurich')).toBe('2026-06-01T18:30');
    expect(zonedWallTimeToUtc('nonsense', 'UTC')).toBeUndefined();
  });
});

describe('hunt: random route', () => {
  const pool = ['a', 'b', 'c', 'd', 'e'].map((id, i) => ({ id, name: `P${id}`, ...north(HOME, 300 * (i + 1)), radiusM: 50, hint: id }));
  const config = (random: Record<string, unknown>, hunt: Record<string, unknown> = {}) =>
    cfg({ version: 2, rules: { hunt: { enabled: true, reveal: 'hint', checkpoints: pool, random: { enabled: true, ...random }, onCheckpoint: [{ type: 'remove_time', seconds: 60 }], ...hunt } } });
  const seq = (values: number[]) => {
    let i = 0;
    return () => values[i++ % values.length]!;
  };

  it('validates the range against the pool', () => {
    expect(parseConfig({ version: 2, rules: { hunt: { enabled: true, checkpoints: pool, random: { enabled: true, min: 3, max: 2 } } } }).ok).toBe(false);
    expect(parseConfig({ version: 2, rules: { hunt: { enabled: true, checkpoints: pool, random: { enabled: true, min: 2, max: 6 } } } }).ok).toBe(false);
    expect(parseConfig({ version: 2, rules: { hunt: { enabled: true, checkpoints: pool, random: { enabled: true, min: 2, max: 5 } } } }).ok).toBe(true);
  });

  it('draws min–max checkpoints in random order at the first evaluation and keeps the route', () => {
    const c = config({ min: 2, max: 4 });
    const s = initialState(c, T0);
    expect(s.hunt.route).toBeUndefined();
    const v0 = buildSessionView({ role: 'wearer', isSelfLock: true, config: c, state: s, history: [], now: T0 });
    expect(v0.hunt).toMatchObject({ total: 4, randomRoute: { drawn: false, min: 2, max: 4, pool: 5 } });
    const r = evaluateTick(c, s, { now: minutes(T0, 1), sessionId: 's1', evalId: 'k1', rng: seq([0.1, 0.9, 0.5, 0.3, 0.99]) });
    const route = r.state.hunt.route!;
    expect(route.length).toBeGreaterThanOrEqual(2);
    expect(route.length).toBeLessThanOrEqual(4);
    expect(new Set(route).size).toBe(route.length);
    const again = evaluateTick(c, r.state, { now: minutes(T0, 2), sessionId: 's1', evalId: 'k2', rng: () => 0 });
    expect(again.state.hunt.route).toEqual(route);
    const v = buildSessionView({ role: 'wearer', isSelfLock: true, config: c, state: again.state, history: [], now: T0 });
    expect(v.hunt!.total).toBe(route.length);
    expect(v.hunt!.hint).toBe(route[0]); // hint = checkpoint id in this fixture
  });

  it('only drawn checkpoints count, in the drawn order; completes after the route', () => {
    const c = config({ min: 2, max: 2 }, { onComplete: [{ type: 'unfreeze' }] });
    const r = new Run(c);
    r.tick(minutes(T0, 1));
    const route = r.state.hunt.route!;
    const pos = (id: string) => pool.find((p) => p.id === id)!;
    const notDrawn = pool.find((p) => !route.includes(p.id))!;
    expect(types(r.checkin(notDrawn, minutes(T0, 5)))).toEqual([]);
    expect(types(r.checkin(pos(route[0]!), minutes(T0, 10)))).toEqual(['remove_time']);
    expect(types(r.checkin(pos(route[1]!), minutes(T0, 15)))).toEqual(['remove_time', 'unfreeze']);
    expect(r.state.hunt.status).toBe('completed');
  });

  it('a wearer-started random hunt draws on start (self-lock)', () => {
    const c = config({ min: 3, max: 3 }, { start: 'wearer' });
    const s = initialState(c, T0);
    const res = applyHuntAction(c, s, 'start', 'wearer', { now: T0, sessionId: 's1', evalId: 'h1', rng: () => 0.5 }, true);
    expect(res.state.hunt.route).toHaveLength(3);
  });
});

describe('surprise missions (F25)', () => {
  const zonesM = [zone('home', 'Home', HOME), zone('gym', 'Gym', GYM, { roles: ['reward'] }), zone('bar', 'Bar', BAR, { roles: ['forbidden'] })];
  const mcfg = (mission: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) =>
    cfg({
      version: 2,
      zones: zonesM,
      rules: { mission: { enabled: true, leadMinutes: 30, onSuccess: [{ type: 'remove_time', seconds: 600 }], onFail: [{ type: 'add_time', seconds: 3600 }], ...mission } },
      ...extra,
    });
  const mctx = (now: Date, rng = () => 0.5) => ({ now, sessionId: 's1', evalId: `m${now.getTime()}`, rng });

  it('validates targets: never forbidden, at least one target, reminder before the end', () => {
    const base = { version: 2, timezone: 'Europe/Zurich', zones: zonesM };
    expect(parseConfig({ ...base, rules: { mission: { enabled: true } } }).ok).toBe(true);
    expect(parseConfig({ ...base, rules: { mission: { enabled: true, zoneIds: ['bar'] } } }).ok).toBe(false);
    expect(parseConfig({ ...base, zones: [zonesM[2]], rules: { mission: { enabled: true } } }).ok).toBe(false);
    expect(parseConfig({ ...base, rules: { mission: { enabled: true, leadMinutes: 10, warnBeforeMinutes: 10 } } }).ok).toBe(false);
    expect(parseConfig({ ...base, rules: { mission: { enabled: true, keyholderCanSend: false, random: { enabled: false } } } }).ok).toBe(false);
  });

  it('a random mission picks a non-forbidden zone away from the wearer; arriving in time succeeds', () => {
    const r = new Run(mcfg());
    r.at(HOME, minutes(T0, 1));
    r.tick(minutes(T0, 2)); // schedules: 4 h × (0.5 + 0.5)
    expect(r.state.mission.nextRandomAt).toBe(minutes(T0, 2 + 240).toISOString());
    expect(nextDueAt(r.config, r.state, minutes(T0, 3))!.toISOString()).toBe(r.state.mission.nextRandomAt);
    const start = r.tick(minutes(T0, 242));
    expect(r.state.mission.active).toMatchObject({ zoneId: 'gym', by: 'random' }); // home: wearer is there; bar: forbidden
    expect(wearer(start.notices)[0]).toMatchObject({ title: '🎯 Surprise mission', priority: 'high' });
    expect(kh(start.notices)[0]).toMatchObject({ kind: 'mission' });
    const v = buildSessionView({ role: 'wearer', isSelfLock: false, config: r.config, state: r.state, history: [], now: minutes(T0, 243) });
    expect(v.mission).toMatchObject({ active: { zoneName: 'Gym' }, actions: ['decline'], declinesLeft: 1 });
    const warn = r.tick(minutes(T0, 242 + 21));
    expect(wearer(warn.notices)[0]!.title).toBe('🎯 Mission ends soon');
    const arrive = r.at(GYM, minutes(T0, 242 + 25));
    expect(types(arrive)).toContain('remove_time');
    expect(r.state.mission).toMatchObject({ active: undefined, succeeded: 1, last: { zoneId: 'gym', outcome: 'success' } });
    expect(r.state.mission.nextRandomAt).toBeDefined();
  });

  it('not there in time: the fail penalty after the grace time', () => {
    const r = new Run(mcfg());
    r.at(HOME, minutes(T0, 1));
    r.tick(minutes(T0, 2));
    r.tick(minutes(T0, 242));
    expect(types(r.tick(minutes(T0, 242 + 30)))).toEqual([]); // at the deadline: still within the grace time
    const fail = r.tick(minutes(T0, 242 + 30 + 1));
    expect(types(fail)).toEqual(['add_time']);
    expect(kh(fail.notices).map((n) => n.kind)).toEqual(expect.arrayContaining(['mission', 'penalty']));
    expect(r.state.mission.failed).toBe(1);
    expect(types(r.at(GYM, minutes(T0, 300)))).not.toContain('remove_time'); // too late
  });

  it('random missions only start within the active hours', () => {
    const r = new Run(mcfg({ random: { everyMinutes: 600, activeHours: { start: '09:00', end: '21:00' } } }));
    r.tick(T0); // 12:00 local + 10 h = 22:00 local → moved to 09:00 local + 30 min (rng 0.5)
    expect(r.state.mission.nextRandomAt).toBe('2026-06-02T07:30:00.000Z');
  });

  it('keyholder sends and cancels; the wearer declines once per day; forbidden zones are refused', () => {
    const c = mcfg({ random: { enabled: false } });
    const s0 = initialState(c, T0);
    expect(() => applyMissionAction(c, s0, { type: 'send', zoneId: 'bar' }, 'keyholder', mctx(T0))).toThrow(MissionActionError);
    expect(() => applyMissionAction(c, s0, { type: 'send', zoneId: 'gym' }, 'wearer', mctx(T0))).toThrow(MissionActionError);
    expect(allowedMissionActions(c, s0, 'keyholder', T0, true)).toEqual([]); // self-lock: nobody sends to themselves
    const sent = applyMissionAction(c, s0, { type: 'send', zoneId: 'home', minutes: 15 }, 'keyholder', mctx(T0));
    expect(sent.state.mission.active).toMatchObject({ zoneId: 'home', by: 'keyholder', dueAt: minutes(T0, 15).toISOString() });
    const declined = applyMissionAction(c, sent.state, { type: 'decline' }, 'wearer', mctx(minutes(T0, 1)));
    expect(declined.consequences).toEqual([]);
    expect(kh(declined.notices)[0]!.title).toBe('Lockation: mission declined');
    const again = applyMissionAction(c, declined.state, { type: 'send', zoneId: 'gym' }, 'keyholder', mctx(minutes(T0, 2)));
    expect(allowedMissionActions(c, again.state, 'wearer', minutes(T0, 3))).toEqual([]); // no decline left today
    const cancelled = applyMissionAction(c, again.state, { type: 'cancel' }, 'keyholder', mctx(minutes(T0, 3)));
    expect(cancelled.state.mission).toMatchObject({ active: undefined, last: { outcome: 'cancelled' }, declined: 1 });
    expect(missionDeclinesLeft(c, cancelled.state, minutes(T0, 24 * 60))).toBe(1); // next day
  });

  it('never targets a forbidden zone', () => {
    const c = mcfg();
    for (let i = 0; i < 20; i++) {
      const res = startRandomMissionNow(c, initialState(c, T0), mctx(T0, () => i / 20));
      expect(res.state.mission.active!.zoneId).not.toBe('bar');
    }
  });
});

describe('hidden zones (F26)', () => {
  const zonesH = [
    zone('home', 'Home', HOME, { roles: ['required'] }),
    zone('bar', 'Secret bar', BAR, { roles: ['forbidden'], hidden: true, hiddenHint: 'somewhere north-west' }),
    zone('gym', 'Treasure', GYM, { roles: ['reward'], hidden: true }),
  ];
  const hcfg = () => cfg({ version: 2, zones: zonesH, rules: { forbidden: { enabled: true, firstWarningAfterMinutes: null, firstPenaltyAfterMinutes: 0, onEnter: [{ type: 'add_time', seconds: 3600 }] }, reward: { enabled: true, onEnter: [{ type: 'remove_time', seconds: 600 }] } } });
  const wview = (c: LockationConfig, s: LockationState) => buildSessionView({ role: 'wearer', isSelfLock: false, config: c, state: s, history: [], now: T0 });

  it('validation: a required zone cannot be hidden; hidden zones are no mission targets', () => {
    const base = { version: 2, timezone: 'Europe/Zurich' };
    expect(parseConfig({ ...base, zones: [zone('a', 'A', HOME, { roles: ['required'], hidden: true })] }).ok).toBe(false);
    expect(parseConfig({ ...base, zones: [zone('a', 'A', HOME), zone('b', 'B', GYM, { hidden: true })], rules: { mission: { enabled: true, zoneIds: ['b'] } } }).ok).toBe(false);
    const c = parseConfig({ ...base, zones: [zone('a', 'A', HOME), zone('b', 'B', GYM, { hidden: true })], rules: { mission: { enabled: true } } });
    expect(c.ok && missionTargets(c.config).map((z) => z.id)).toEqual(['a']);
  });

  it('the wearer sees only the count and hints; the keyholder sees everything', () => {
    const c = hcfg();
    const s = initialState(c, T0);
    const v = wview(c, s);
    expect(v.zones.map((z) => z.id)).toEqual(['home']);
    expect(JSON.stringify(v.rules)).not.toMatch(/Secret bar|Treasure/);
    expect(v.hiddenZones).toEqual({ count: 2, forbidden: 1, reward: 1, other: 0, hints: ['somewhere north-west'] });
    const k = buildSessionView({ role: 'keyholder', isSelfLock: false, config: c, state: s, history: [], now: T0 });
    expect(k.zones.find((z) => z.id === 'bar')!.hidden).toBe('hidden');
    expect(owntracksWaypoints(c, s).command.waypoints.waypoints.map((w: any) => w.desc)).toEqual(['Home']);
  });

  it('walking into a hidden zone reveals it and its rule still applies', () => {
    const r = new Run(hcfg());
    const res = r.checkin(BAR, minutes(T0, 5));
    expect(types(res)).toContain('add_time');
    expect(wearer(res.notices).some((n) => n.title === '🔍 Hidden zone discovered')).toBe(true);
    const v = wview(r.config, r.state);
    expect(v.zones.map((z) => z.id)).toEqual(['home', 'bar']);
    expect(v.zones.find((z) => z.id === 'bar')!.hidden).toBe('discovered');
    expect(v.hiddenZones).toMatchObject({ count: 1, reward: 1 });
    expect(owntracksWaypoints(r.config, r.state).command.waypoints.waypoints.map((w: any) => w.desc)).toEqual(['Home', 'Secret bar']);
  });

  it('change notices never describe hidden zones', () => {
    const before = hcfg();
    const after = cfg({ version: 2, zones: [...zonesH, zone('x', 'New trap', north(HOME, 2000), { roles: ['forbidden'], hidden: true })], rules: { forbidden: { enabled: true }, reward: { enabled: true } } });
    const d = diffConfig(before, after);
    expect(d.join(' ')).not.toMatch(/New trap|Secret bar|Treasure/);
    expect(d).toContain('Hidden zones changed (now 3 hidden zones).');
  });
});
