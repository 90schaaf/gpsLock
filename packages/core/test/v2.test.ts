import { describe, expect, it } from 'vitest';
import {
  activeWindowStart,
  allowedHuntActions,
  applyHuntAction,
  HuntActionError,
  buildSessionView,
  diffConfig,
  evaluateCheckin,
  evaluateTick,
  evaluateTracked,
  initialState,
  loadState,
  migrateConfig,
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

describe('v1 → v2 migration', () => {
  it('derives roles, anywhere/combine, forbidden timings and turns the curfew into stay windows', () => {
    const v1 = {
      timezone: 'Europe/Zurich',
      zones: [zone('home', 'Home', HOME), zone('work', 'Work', WORK), zone('bar', 'Bar', BAR), zone('gym', 'Gym', GYM)],
      tracking: { enabled: true, entryConfirmMinutes: 4 },
      rules: {
        required: { enabled: true, zoneIds: ['home', 'work'] },
        forbidden: { enabled: true, zoneIds: ['bar'], cooldownMinutes: 30 },
        reward: { enabled: true, zoneIds: ['gym'] },
        curfew: { enabled: true, zoneIds: ['home'], start: '23:00', end: '06:00', cooldownMinutes: 45, onOutside: [{ type: 'add_time', seconds: 60 }] },
      },
    };
    const res = parseConfig(v1);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const c = res.config;
    expect(c.version).toBe(2);
    expect(c.zones.map((z) => [z.id, z.roles])).toEqual([
      ['home', ['required']],
      ['work', ['required']],
      ['bar', ['forbidden']],
      ['gym', ['reward']],
    ]);
    expect(c.rules.required).toMatchObject({ enabled: true, anywhere: false, combine: 'any', graceMinutes: 15, windowCooldownMinutes: 45 });
    expect(c.zones[0]!.required).toMatchObject({ intervalCheckins: true, stayWindows: [{ start: '23:00', end: '06:00' }] });
    expect(c.rules.forbidden).toMatchObject({ firstPenaltyAfterMinutes: 4, repeatEveryMinutes: 30, firstWarningAfterMinutes: null, repeatWarningAfterMinutes: null });
    expect(c.rules.hunt.reveal).toBe('distance');
    expect(migrateConfig(c)).toBe(c);
  });

  it('a v1 required rule without zones becomes "anywhere"; a curfew-only zone gets no interval check-ins', () => {
    const c = cfg({ zones: [zone('home', 'Home', HOME)], tracking: { enabled: true }, rules: { required: { enabled: false }, curfew: { enabled: true, zoneIds: ['home'] } } });
    expect(c.rules.required).toMatchObject({ enabled: true, anywhere: false });
    expect(c.zones[0]!.required.intervalCheckins).toBe(false);
    const any = cfg({ rules: { required: { enabled: true } } });
    expect(any.rules.required.anywhere).toBe(true);
  });

  it('migrates v1 state: the single deadline becomes the slot', () => {
    const c = cfg({ zones: [zone('home', 'Home', HOME)], rules: { required: { enabled: true, zoneIds: ['home'] } } });
    const raw = { v: 1, startedAt: T0.toISOString(), required: { nextDeadline: '2026-06-01T12:00:00.000Z', missedCount: 2 } };
    const st = loadState(raw, c, T0);
    expect(st.required.slots.home).toMatchObject({ nextDeadline: '2026-06-01T12:00:00.000Z', missedCount: 2 });
  });
});

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
    const c = cfg({ version: 2, tracking: { ...tracking, liveOnly: true }, antiCheat: { liveVerificationEveryHours: 4 } });
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
  it('1 min with background check-ins, 5 min with manual check-ins only', () => {
    expect(req({ enabled: true }, 1).ok).toBe(true);
    expect(req({ enabled: true, countsAsCheckin: false }, 1).ok).toBe(false);
    expect(req({ enabled: false }, 4).ok).toBe(false);
    expect(req({ enabled: false }, 5).ok).toBe(true);
  });
  it('OwnTracks reports every half interval (30–300 s) and switches to move mode', () => {
    const c = cfg({ version: 2, zones: [zone('home', 'Home', HOME, { roles: ['required'] })], tracking: { enabled: true, heartbeatMinutes: 180 }, rules: { required: { enabled: true, intervalMinutes: 2 } } });
    expect(owntracksLocatorInterval(c)).toBe(60);
    expect(owntracksMonitoring(c)).toBe(2);
    const slow = cfg({ version: 2, zones: [zone('home', 'Home', HOME, { roles: ['required'] })], tracking: { enabled: true, heartbeatMinutes: 180 }, rules: { required: { enabled: true, intervalMinutes: 240 } } });
    expect(owntracksLocatorInterval(slow)).toBe(300);
    expect(owntracksMonitoring(slow)).toBe(1);
  });
});
