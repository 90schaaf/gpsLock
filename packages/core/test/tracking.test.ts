import { describe, expect, it } from 'vitest';
import {
  buildSessionView,
  computeMetadata,
  evaluateCheckin,
  evaluateTick,
  evaluateTracked,
  initialState,
  owntracksConfigLink,
  owntracksWaypoints,
  parseConfig,
  parseOwnTracks,
  trackingStatus,
  type LockationConfig,
  type LockationState,
  type TrackedInput,
} from '../src/index.js';
import { BAR, GYM, HOME, Sim, T0, cfg, fixAt, minutes, north, types, zones, slot0 } from './helpers.js';

class Tracker {
  state: LockationState;
  n = 0;
  constructor(
    public config: LockationConfig,
    start = T0,
  ) {
    this.state = initialState(config, start);
  }
  send(input: TrackedInput, now: Date) {
    const r = evaluateTracked(this.config, this.state, input, { now, sessionId: 's1', evalId: `t${++this.n}` });
    this.state = r.state;
    return r;
  }
  at(p: { lat: number; lng: number }, at: Date, accuracy = 15, receivedAt = at) {
    return this.send({ fix: fixAt(p, at, accuracy) }, receivedAt);
  }
}

const tracking = { enabled: true, heartbeatMinutes: 120, entryConfirmMinutes: 5, onHeartbeatMissed: [{ type: 'add_time' as const, seconds: 1800 }] };

describe('F14 background tracking – evaluation', () => {
  it('AC3 forbidden zone triggers after entryConfirmMinutes of presence', () => {
    const t = new Tracker(cfg({ zones: [zones.bar], tracking, rules: { forbidden: { enabled: true, zoneIds: ['bar'], onEnter: [{ type: 'add_time', seconds: 3600 }] } } }));
    const first = t.at(BAR, T0);
    expect(types(first)).toEqual([]);
    expect(first.notable).toBe(true); // entered
    expect(first.events).toContain('Entered "Bar".');
    expect(types(t.at(BAR, minutes(T0, 3)))).toEqual([]);
    expect(types(t.at(BAR, minutes(T0, 6)))).toEqual(['add_time']);
    expect(types(t.at(BAR, minutes(T0, 8)))).toEqual([]); // cooldown
  });

  it('v1 config: a visit only noticed on leave gets the penalties of its whole stay (v2 timeline)', () => {
    const t = new Tracker(cfg({ zones: [zones.bar], tracking, rules: { forbidden: { enabled: true, zoneIds: ['bar'], cooldownMinutes: 0, onEnter: [{ type: 'add_time', seconds: 3600 }] } } }));
    t.send({ transition: { event: 'enter', zoneId: 'bar', at: T0.getTime() }, fix: fixAt(BAR, T0) }, T0);
    const leave = t.send({ transition: { event: 'leave', zoneId: 'bar', at: minutes(T0, 20).getTime() }, fix: fixAt(north(BAR, 400), minutes(T0, 20)) }, minutes(T0, 20));
    // v1 cooldown 0 → repeat every 5 min (minimum); first penalty after entryConfirm (5 min): 5, 10, 15, 20 min
    expect(types(leave)).toEqual(['add_time', 'add_time', 'add_time', 'add_time']);
    expect(leave.events.join(' ')).toMatch(/for 20 min – penalty 4/);
    // short visit → nothing
    t.at(BAR, minutes(T0, 60));
    expect(types(t.at(north(BAR, 600), minutes(T0, 62)))).toEqual([]);
  });

  it('AC4 hysteresis keeps presence inside the accuracy margin', () => {
    const t = new Tracker(cfg({ zones: [zones.home], tracking }));
    t.at(HOME, T0, 10);
    t.at(north(HOME, 130), minutes(T0, 5), 50); // 130 m, radius 100, acc 50 → ambiguous
    expect(Object.keys(t.state.presence)).toEqual(['home']);
    t.at(north(HOME, 300), minutes(T0, 10), 20); // clearly outside
    expect(Object.keys(t.state.presence)).toEqual([]);
  });

  it('AC5 reward dwell time is respected (manual check-ins use the same presence)', () => {
    const config = cfg({ zones: [zones.gym], tracking, rules: { reward: { enabled: true, zoneIds: ['gym'], dwellMinutes: 45, onEnter: [{ type: 'remove_time', seconds: 3600 }] } } });
    const t = new Tracker(config);
    expect(types(t.at(GYM, T0))).toEqual([]);
    expect(types(t.at(GYM, minutes(T0, 30)))).toEqual([]);
    expect(types(t.at(GYM, minutes(T0, 46)))).toEqual(['remove_time']);
    expect(types(t.at(GYM, minutes(T0, 60)))).toEqual([]); // once per visit
    // manual check-in: shows remaining dwell time
    const sim = new Sim(config);
    expect(sim.checkin(GYM, T0).events.join(' ')).toMatch(/stay 45 more min/);
    expect(types(sim.checkin(GYM, minutes(T0, 50)))).toEqual(['remove_time']);
  });

  it('AC6 counts as required check-in (without onSuccess) and never as a wrong hunt guess', () => {
    const config = cfg({
      zones: [zones.home],
      tracking,
      rules: {
        required: { enabled: true, zoneIds: ['home'], intervalMinutes: 240, onSuccess: [{ type: 'log', message: 'x' }], onOutside: [{ type: 'freeze' }] },
        hunt: { enabled: true, checkpoints: [{ id: 'c1', name: 'C1', ...GYM, radiusM: 80, hint: '' }], onWrong: [{ type: 'add_time', seconds: 60 }], onCheckpoint: [{ type: 'remove_time', seconds: 60 }] },
      },
    });
    const t = new Tracker(config);
    const r = t.at(HOME, minutes(T0, 100));
    expect(types(r)).toEqual([]);
    expect(slot0(t.state).nextDeadline).toBe(minutes(T0, 340).toISOString());
    expect(types(t.at(BAR, minutes(T0, 120)))).toEqual([]); // outside: no onOutside, no wrong guess
    expect(types(t.at(GYM, minutes(T0, 130)))).toEqual(['remove_time']); // checkpoint found by tracking
    const noCount = cfg({ zones: [zones.home], tracking: { ...tracking, countsAsCheckin: false }, rules: { required: { enabled: true, zoneIds: ['home'] } } });
    const t2 = new Tracker(noCount);
    const before = slot0(t2.state).nextDeadline;
    t2.at(HOME, minutes(T0, 10));
    expect(slot0(t2.state).nextDeadline).toBe(before);
  });

  it('AC7 out of order / too old positions are ignored but count as heartbeat', () => {
    const t = new Tracker(cfg({ zones: [zones.bar], tracking: { ...tracking, maxDelayMinutes: 60 }, rules: { forbidden: { enabled: true, zoneIds: ['bar'], onEnter: [{ type: 'add_time', seconds: 1 }] } } }));
    t.at(HOME, minutes(T0, 10));
    const old = t.at(BAR, minutes(T0, 5), 15, minutes(T0, 11));
    expect(old.record.reason).toBe('out_of_order');
    expect(old.notable).toBe(false);
    const stale = t.at(BAR, minutes(T0, 20), 15, minutes(T0, 200));
    expect(stale.record.reason).toBe('stale_fix');
    expect(t.state.tracking.lastSeenAt).toBe(minutes(T0, 200).toISOString());
    expect(t.state.tracking.nextHeartbeat).toBe(minutes(T0, 320).toISOString());
  });

  it('queued positions are evaluated at their own time', () => {
    const t = new Tracker(cfg({ zones: [zones.bar], tracking: { ...tracking, entryConfirmMinutes: 0 }, rules: { forbidden: { enabled: true, zoneIds: ['bar'], onEnter: [{ type: 'add_time', seconds: 1 }] } } }));
    const r = t.at(BAR, minutes(T0, 0), 15, minutes(T0, 30));
    expect(types(r)).toEqual(['add_time']);
    expect(t.state.forbidden.visits.bar!.lastPenaltyAt).toBe(T0.toISOString());
  });

  it('implausible tracked jumps are rejected without penalty', () => {
    const t = new Tracker(cfg({ tracking, antiCheat: { maxSpeedKmh: 100, onImplausible: 'reject_and_penalize', implausibleConsequences: [{ type: 'add_time', seconds: 1 }] } }));
    t.at(HOME, T0);
    const r = t.at(north(HOME, 50_000), minutes(T0, 5));
    expect(r.record).toMatchObject({ outcome: 'rejected', reason: 'implausible_speed' });
    expect(r.consequences).toHaveLength(0);
  });

  it('AC8 heartbeat missed once per interval; first deadline from session start', () => {
    const config = cfg({ tracking });
    const state = initialState(config, T0);
    expect(state.tracking.nextHeartbeat).toBe(minutes(T0, 120).toISOString());
    const ctx = (m: number) => ({ now: minutes(T0, m), sessionId: 's1', evalId: `tick${m}` });
    expect(evaluateTick(config, state, ctx(100)).consequences).toHaveLength(0);
    const r = evaluateTick(config, state, ctx(125));
    expect(types(r)).toEqual(['add_time']);
    expect(r.events[0]).toMatch(/not been set up/);
    expect(evaluateTick(config, r.state, ctx(130)).consequences).toHaveLength(0);
    expect(evaluateTick(config, state, ctx(125 + 240)).consequences).toHaveLength(3);
  });
});

describe('F15 curfew', () => {
  const curfewCfg = () =>
    cfg({
      zones: [zones.home],
      tracking,
      rules: { curfew: { enabled: true, zoneIds: ['home'], start: '22:00', end: '06:00', cooldownMinutes: 30, onOutside: [{ type: 'add_time', seconds: 3600 }] } },
    });
  // 22:30 Zurich (CEST) = 20:30Z
  const night = new Date('2026-06-01T20:30:00Z');

  it('AC1 outside during curfew → penalty with cooldown', () => {
    const t = new Tracker(curfewCfg());
    expect(types(t.at(BAR, night))).toEqual(['add_time']);
    expect(types(t.at(BAR, minutes(night, 10)))).toEqual([]);
    expect(types(t.at(BAR, minutes(night, 40)))).toEqual(['add_time']);
  });

  it('AC2 inside the zone or outside the window → nothing', () => {
    const t = new Tracker(curfewCfg());
    expect(types(t.at(HOME, night))).toEqual([]);
    expect(types(new Tracker(curfewCfg()).at(BAR, new Date('2026-06-01T12:00:00Z')))).toEqual([]);
  });

  it('AC3 validation', () => {
    expect(parseConfig({ zones: [zones.home], rules: { curfew: { enabled: true, zoneIds: ['home'] } } }).ok).toBe(false);
    expect(parseConfig({ zones: [zones.home], tracking: { enabled: true }, rules: { curfew: { enabled: true, zoneIds: [] } } }).ok).toBe(false);
    expect(parseConfig({ zones: [zones.home], tracking: { enabled: true }, rules: { curfew: { enabled: true, zoneIds: ['home'] } } }).ok).toBe(true);
  });
});

describe('F14 OwnTracks format helpers', () => {
  const config = cfg({ zones: [zones.home, zones.bar], tracking, rules: { hunt: { enabled: true, checkpoints: [{ id: 'c1', name: 'Secret', ...GYM, radiusM: 80, hint: '' }] } } });

  it('AC1 provisioning link contains HTTP mode config', () => {
    const link = owntracksConfigLink({ url: 'https://w.test/track/owntracks', username: 'lo-abc', password: 'pw' });
    expect(link.startsWith('owntracks:///config?inline=')).toBe(true);
    const json = JSON.parse(atob(decodeURIComponent(link.split('inline=')[1]!)));
    expect(json).toMatchObject({ _type: 'configuration', mode: 3, url: 'https://w.test/track/owntracks', auth: true, username: 'lo-abc', password: 'pw', monitoring: 1 });
  });

  it('AC9 waypoints contain zones only, with stable keys and hash', () => {
    const a = owntracksWaypoints(config);
    expect(a.command.waypoints.waypoints.map((w) => w.desc)).toEqual(['Home', 'Bar']);
    expect(JSON.stringify(a)).not.toContain('Secret');
    expect(owntracksWaypoints(config).hash).toBe(a.hash);
    const moved = { ...config, zones: [{ ...config.zones[0]!, radiusM: 200 }, config.zones[1]!] };
    expect(owntracksWaypoints(moved).hash).not.toBe(a.hash);
    expect(owntracksWaypoints(moved).command.waypoints.waypoints[0]!.tst).toBe(a.command.waypoints.waypoints[0]!.tst);
  });

  it('parses location and transition messages', () => {
    expect(parseOwnTracks({ _type: 'location', lat: 47.1, lon: 8.2, acc: 12, tst: 1_780_000_000, tid: 'LO' }, config)).toEqual({
      fix: { lat: 47.1, lng: 8.2, accuracy: 12, timestamp: 1_780_000_000_000 },
    });
    const tr = parseOwnTracks({ _type: 'transition', event: 'leave', desc: 'Bar', tst: 1_780_000_100, wtst: 1, acc: 20, lat: 47.39, lon: 8.515 }, config);
    expect(tr?.transition).toEqual({ event: 'leave', zoneId: 'bar', at: 1_780_000_100_000 });
    expect(parseOwnTracks({ _type: 'transition', event: 'enter', desc: 'Unknown', tst: 5, wtst: 1, acc: 1 }, config)).toEqual({
      fix: undefined,
      transition: { event: 'enter', zoneId: undefined, at: 5000 },
    });
    expect(parseOwnTracks({ _type: 'waypoint', desc: 'x', tst: 1 }, config)).toBeUndefined();
    expect(parseOwnTracks({ _type: 'location', lat: 'x', lon: 1, tst: 1 }, config)).toBeUndefined();
    expect(parseOwnTracks(null, config)).toBeUndefined();
  });
});

describe('F16 live tracking only', () => {
  const live = { ...tracking, liveOnly: true, countsAsCheckin: false };
  const liveCfg = () =>
    cfg({
      zones: [zones.home, zones.gym],
      tracking: live,
      rules: {
        required: { enabled: true, zoneIds: ['home'], intervalMinutes: 240, graceMinutes: 0, onMissed: [{ type: 'freeze' }], onSuccess: [{ type: 'unfreeze' }] },
        hunt: { enabled: true, checkpoints: [{ id: 'c1', name: 'Gym', ...GYM, radiusM: 100, hint: 'gym' }], onCheckpoint: [{ type: 'remove_time', seconds: 60 }] },
      },
    });

  it('AC1 needs background tracking enabled', () => {
    const bad = parseConfig({ tracking: { enabled: false, liveOnly: true } });
    expect(bad.ok).toBe(false);
    expect(parseConfig({ tracking: { enabled: true, liveOnly: true } }).ok).toBe(true);
  });

  it('AC2 manual check-ins are rejected without consequences', () => {
    const config = liveCfg();
    const r = evaluateCheckin(config, initialState(config, T0), fixAt(HOME, minutes(T0, 1)), { now: minutes(T0, 1), sessionId: 's1', evalId: 'm1' });
    expect(r.record.outcome).toBe('rejected');
    expect(r.record.reason).toBe('manual_disabled');
    expect(r.consequences).toEqual([]);
    expect(r.state.acceptedCount).toBe(0);
  });

  it('AC3 background updates count as required check-ins even if countsAsCheckin is off', () => {
    const t = new Tracker(liveCfg());
    t.at(HOME, minutes(T0, 100));
    expect(slot0(t.state).nextDeadline).toBe(minutes(T0, 340).toISOString());
  });

  it('AC4 the first valid update after a missed deadline fires onSuccess once (recovery)', () => {
    const t = new Tracker(liveCfg());
    const tick = evaluateTick(t.config, t.state, { now: minutes(T0, 241), sessionId: 's1', evalId: 'k1' });
    t.state = tick.state;
    expect(types(tick)).toContain('freeze');
    const back = t.at(HOME, minutes(T0, 250));
    expect(types(back)).toEqual(['unfreeze']);
    expect(back.events).toContain('Back in "Home" – check-in counted.');
    expect(types(t.at(HOME, minutes(T0, 260)))).toEqual([]);
  });

  it('AC5 hunt checkpoints are found by walking into them', () => {
    const t = new Tracker(liveCfg());
    expect(types(t.at(GYM, minutes(T0, 30)))).toEqual(['remove_time']);
  });

  it('AC6 view and lock page action reflect live-only mode', () => {
    const config = liveCfg();
    const state = initialState(config, T0);
    const view = buildSessionView({ role: 'wearer', isSelfLock: true, config, state, history: [], now: T0 });
    expect(view.liveOnly).toBe(true);
    expect(view.rules.find((r) => r.rule === 'tracking')?.lines.join(' ')).toMatch(/Manual check-ins are disabled/);
    const meta = computeMetadata(config, state, T0);
    expect(meta.homeActions[0]).toMatchObject({ title: 'GPS live tracking', description: 'Set up live tracking!', badge: '!' });
    state.tracking.deviceUser = 'u1';
    expect(computeMetadata(config, state, T0).homeActions[0]!.description).toMatch(/^Be in a required zone by/);
  });
});

describe('tracking status and position visibility', () => {
  const config = cfg({ zones: [zones.home], tracking, privacy: { coordinates: 'zone_only' } });
  const base = () => initialState(config, T0);

  it('is "connected" only after a location from the current pairing arrived recently', () => {
    const s = base();
    expect(trackingStatus(s, 120, T0)).toBe('not_set_up');
    s.tracking.deviceUser = 'u1';
    s.tracking.pairedAt = minutes(T0, 10).toISOString();
    expect(trackingStatus(s, 120, minutes(T0, 11))).toBe('waiting');
    s.tracking.lastSeenAt = minutes(T0, 5).toISOString(); // from an earlier pairing
    expect(trackingStatus(s, 120, minutes(T0, 11))).toBe('waiting');
    s.tracking.lastSeenAt = minutes(T0, 12).toISOString();
    expect(trackingStatus(s, 120, minutes(T0, 13))).toBe('connected');
    expect(trackingStatus(s, 120, minutes(T0, 12 + 121))).toBe('no_signal');
  });

  it('shows the last position to the wearer, to the keyholder only with exact sharing', () => {
    const s = base();
    s.lastAccepted = { lat: 47.377, lng: 8.542, accuracy: 12, at: T0.toISOString() };
    const view = (role: 'wearer' | 'keyholder', c: LockationConfig) => buildSessionView({ role, isSelfLock: false, config: c, state: s, history: [], now: T0 });
    expect(view('wearer', config).lastPosition).toMatchObject({ lat: 47.377, approximate: true });
    expect(view('keyholder', config).lastPosition).toBeUndefined();
    const exact = cfg({ zones: [zones.home], tracking, privacy: { coordinates: 'exact' } });
    expect(view('keyholder', exact).lastPosition).toMatchObject({ lat: 47.377, approximate: false });
  });
});
