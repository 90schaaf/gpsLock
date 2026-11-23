import { describe, expect, it } from 'vitest';
import { buildSessionView, computeMetadata, evaluateCheckin, evaluateTick, initialState } from '../src/index.js';
import { BAR, GYM, HOME, NEW_YORK, Sim, T0, cfg, fixAt, minutes, north, types } from './helpers.js';

const checkpoints = [
  { id: 'c1', name: 'Fountain', ...HOME, radiusM: 80, hint: 'Where the trains meet' },
  { id: 'c2', name: 'Gym', ...GYM, radiusM: 80, hint: 'Where you sweat' },
  { id: 'c3', name: 'Bar', ...BAR, radiusM: 80, hint: 'Last stop' },
];

const huntCfg = (extra: object = {}) =>
  cfg({
    rules: {
      hunt: {
        enabled: true,
        checkpoints,
        reveal: 'distance',
        wrongCooldownMinutes: 10,
        timeLimitMinutes: 600,
        blockUnlockUntilComplete: true,
        onCheckpoint: [{ type: 'remove_time', seconds: 600 }],
        onWrong: [{ type: 'add_time', seconds: 900 }],
        onComplete: [{ type: 'remove_time', seconds: 7200 }],
        onTimeout: [{ type: 'add_time', seconds: 86400 }],
        ...extra,
      },
    },
  });

describe('F6 scavenger hunt', () => {
  it('AC1 advances in order and completes', () => {
    const sim = new Sim(huntCfg());
    expect(types(sim.checkin(HOME, minutes(T0, 5)))).toEqual(['remove_time']);
    expect(sim.state.hunt.index).toBe(1);
    // being at checkpoint 3 before 2 does not count (and is a wrong turn only for hunt check-ins)
    expect(types(sim.checkin(BAR, minutes(T0, 20)))).toEqual([]);
    expect(types(sim.checkin(GYM, minutes(T0, 40)))).toEqual(['remove_time']);
    const last = sim.checkin(BAR, minutes(T0, 60));
    expect(types(last)).toEqual(['remove_time', 'remove_time']);
    expect(last.consequences[1]!.consequence).toEqual({ type: 'remove_time', seconds: 7200 });
    expect(sim.state.hunt.status).toBe('completed');
  });

  it('AC2 wrong hunt check-in adds time with cooldown and distance band', () => {
    const sim = new Sim(huntCfg());
    const r = sim.checkin(north(HOME, 700), minutes(T0, 1), { purpose: 'hunt' });
    expect(types(r)).toEqual(['add_time']);
    expect(sim.state.hunt.lastDistanceBand).toBe('<1km');
    expect(types(sim.checkin(north(HOME, 300), minutes(T0, 5), { purpose: 'hunt' }))).toEqual([]);
    expect(sim.state.hunt.lastDistanceBand).toBe('<500m');
    expect(types(sim.checkin(north(HOME, 300), minutes(T0, 15), { purpose: 'hunt' }))).toEqual(['add_time']);
  });

  it('AC3 future checkpoints are never exposed to the wearer', () => {
    const config = huntCfg({ reveal: 'map' });
    const sim = new Sim(config);
    sim.checkin(HOME, minutes(T0, 1));
    const view = buildSessionView({ role: 'wearer', isSelfLock: false, config, state: sim.state, history: [], now: minutes(T0, 2) });
    const json = JSON.stringify(view);
    expect(view.hunt?.hint).toBe('Where you sweat');
    expect(view.hunt?.target).toEqual({ lat: GYM.lat, lng: GYM.lng, radiusM: 80 });
    expect(json).not.toContain('Last stop');
    expect(json).not.toContain(String(BAR.lat));
  });

  it('AC4 timeout applied once', () => {
    const config = huntCfg();
    const state = initialState(config, T0);
    const r = evaluateTick(config, state, { now: minutes(T0, 601), sessionId: 's', evalId: 't1' });
    expect(types(r)).toEqual(['add_time']);
    expect(r.state.hunt.status).toBe('failed');
    expect(evaluateTick(config, r.state, { now: minutes(T0, 700), sessionId: 's', evalId: 't2' }).consequences).toHaveLength(0);
  });

  it('AC5 unlock blocker while active', () => {
    const config = huntCfg();
    const sim = new Sim(config);
    expect(computeMetadata(config, sim.state, T0).reasonsPreventingUnlocking).toHaveLength(1);
    sim.checkin(HOME, minutes(T0, 1));
    sim.checkin(GYM, minutes(T0, 20));
    sim.checkin(BAR, minutes(T0, 40));
    expect(computeMetadata(config, sim.state, T0).reasonsPreventingUnlocking).toHaveLength(0);
  });
});

describe('F8 anti-cheat', () => {
  const config = cfg({
    rules: { required: { enabled: true, onSuccess: [{ type: 'log', message: 'ok' }] } },
    antiCheat: { maxAccuracyM: 50, maxFixAgeSeconds: 60, maxSpeedKmh: 200, minIntervalSeconds: 60 },
  });

  it('AC1 poor accuracy rejected without evaluating rules', () => {
    const sim = new Sim(config);
    const before = JSON.parse(JSON.stringify(sim.state));
    const r = sim.checkin(HOME, T0, { accuracy: 80 });
    expect(r.record).toMatchObject({ outcome: 'rejected', reason: 'poor_accuracy' });
    expect(r.consequences).toHaveLength(0);
    expect({ ...sim.state, lastAttemptAt: undefined, checkinCount: 0 }).toEqual({ ...before, lastAttemptAt: undefined, checkinCount: 0 });
  });

  it('AC2 stale and future fixes rejected', () => {
    const state = initialState(config, T0);
    const ctx = { now: T0, sessionId: 's', evalId: 'x' };
    expect(evaluateCheckin(config, state, fixAt(HOME, minutes(T0, -2)), ctx).record.reason).toBe('stale_fix');
    expect(evaluateCheckin(config, state, fixAt(HOME, minutes(T0, 1)), ctx).record.reason).toBe('future_fix');
    expect(evaluateCheckin(config, state, fixAt(HOME, new Date(T0.getTime() - 10_000)), ctx).record.outcome).toBe('accepted');
  });

  it('AC3 implausible speed handled per mode', () => {
    const sim = new Sim(config);
    sim.checkin(HOME, T0);
    const r = sim.checkin(NEW_YORK, minutes(T0, 60));
    expect(r.record).toMatchObject({ outcome: 'rejected', reason: 'implausible_speed', flagged: 'implausible_speed' });

    const penal = cfg({ antiCheat: { onImplausible: 'reject_and_penalize', implausibleConsequences: [{ type: 'add_time', seconds: 3600 }] } });
    const sim2 = new Sim(penal);
    sim2.checkin(HOME, T0);
    expect(types(sim2.checkin(NEW_YORK, minutes(T0, 60)))).toEqual(['add_time']);

    // walking speed is fine
    const sim3 = new Sim(config);
    sim3.checkin(HOME, T0);
    expect(sim3.checkin(north(HOME, 1000), minutes(T0, 12)).record.outcome).toBe('accepted');
  });

  it('AC4 random verification uses injected rng', () => {
    const rnd = cfg({ antiCheat: { verificationPicture: 'random', verificationProbability: 0.3 } });
    expect(types(new Sim(rnd).checkin(HOME, T0, { rng: () => 0.1 }))).toEqual(['verification_picture']);
    expect(types(new Sim(rnd).checkin(HOME, T0, { rng: () => 0.5 }))).toEqual([]);
    const always = cfg({ antiCheat: { verificationPicture: 'always' } });
    expect(types(new Sim(always).checkin(HOME, T0))).toEqual(['verification_picture']);
  });

  it('AC5 rate limit', () => {
    const sim = new Sim(config);
    sim.checkin(HOME, T0);
    expect(sim.checkin(HOME, minutes(T0, 0.5)).record.reason).toBe('rate_limited');
    expect(sim.checkin(HOME, minutes(T0, 2)).record.outcome).toBe('accepted');
  });
});

describe('F9 privacy', () => {
  it('AC1 zone_only records have no coordinates and state is rounded', () => {
    const sim = new Sim(cfg({}));
    const r = sim.checkin({ lat: 47.376912, lng: 8.541734 }, T0);
    expect(r.record.lat).toBeUndefined();
    expect(sim.state.lastAccepted).toMatchObject({ lat: 47.377, lng: 8.542 });
  });
  it('exact mode stores coordinates; override hides them in the view', () => {
    const config = cfg({ privacy: { coordinates: 'exact' } });
    const sim = new Sim(config);
    const r = sim.checkin(HOME, T0);
    expect(r.record.lat).toBe(HOME.lat);
    const state = { ...sim.state, privacyOverride: 'zone_only' as const };
    const view = buildSessionView({ role: 'keyholder', isSelfLock: false, config, state, history: [r.record], now: T0 });
    expect(view.privacy).toBe('zone_only');
    expect(view.history[0]!.lat).toBeUndefined();
  });
});

describe('F7/F12 timed freeze and metadata', () => {
  it('timed freeze is unfrozen by the tick', () => {
    const config = cfg({ zones: [{ id: 'bar', name: 'Bar', ...BAR, radiusM: 100 }], rules: { forbidden: { enabled: true, zoneIds: ['bar'], onEnter: [{ type: 'freeze', durationMinutes: 30 }] } } });
    const sim = new Sim(config);
    sim.checkin(BAR, T0);
    expect(sim.state.freezeUntil).toBe(minutes(T0, 30).toISOString());
    expect(evaluateTick(config, sim.state, { now: minutes(T0, 20), sessionId: 's', evalId: 't' }).consequences).toHaveLength(0);
    const r = evaluateTick(config, sim.state, { now: minutes(T0, 31), sessionId: 's', evalId: 't' });
    expect(types(r)).toEqual(['unfreeze']);
    expect(r.state.freezeUntil).toBeUndefined();
  });

  it('metadata shows overdue badge', () => {
    const config = cfg({ rules: { required: { enabled: true, intervalMinutes: 60 } } });
    const state = initialState(config, T0);
    expect(computeMetadata(config, state, minutes(T0, 30)).homeActions[0]!.badge).toBeUndefined();
    const md = computeMetadata(config, state, minutes(T0, 61));
    expect(md.homeActions[0]!.badge).toBe('!');
    expect(md.reasonsPreventingUnlocking).toContain('A required GPS check-in is overdue.');
  });
});
