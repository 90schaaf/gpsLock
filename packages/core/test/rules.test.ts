import { describe, expect, it } from 'vitest';
import { evaluateTick, adjustForQuietHours, MAX_MISSED_PER_TICK } from '../src/index.js';
import { BAR, GYM, HOME, Sim, T0, cfg, minutes, north, types, zones, slot0 } from './helpers.js';

const addHour = { type: 'add_time' as const, seconds: 3600 };
const removeHour = { type: 'remove_time' as const, seconds: 3600 };

describe('F2 required check-in', () => {
  const config = cfg({
    zones: [zones.home],
    rules: {
      required: { enabled: true, zoneIds: ['home'], intervalMinutes: 240, graceMinutes: 15, onMissed: [addHour], onOutside: [{ type: 'freeze' }], onSuccess: [{ type: 'unfreeze' }] },
    },
  });

  it('initial deadline = start + interval', () => {
    const sim = new Sim(config);
    expect(slot0(sim.state).nextDeadline).toBe(minutes(T0, 240).toISOString());
  });

  it('AC1 a valid check-in resets the deadline', () => {
    const sim = new Sim(config);
    const at = minutes(T0, 100);
    const r = sim.checkin(HOME, at);
    expect(r.record.outcome).toBe('accepted');
    expect(r.record.zones).toEqual(['Home']);
    expect(types(r)).toEqual(['unfreeze']);
    expect(slot0(sim.state).nextDeadline).toBe(minutes(at, 240).toISOString());
  });

  it('AC2 an outside check-in applies onOutside and keeps the deadline', () => {
    const sim = new Sim(config);
    const before = slot0(sim.state).nextDeadline;
    const r = sim.checkin(GYM, minutes(T0, 30));
    expect(types(r)).toEqual(['freeze']);
    expect(slot0(sim.state).nextDeadline).toBe(before);
  });

  it('AC3 missed is applied once per interval, idempotent', () => {
    const sim = new Sim(config);
    const ctx = (m: number, id = 't') => ({ now: minutes(T0, m), sessionId: 's1', evalId: id });
    expect(evaluateTick(config, sim.state, ctx(250)).consequences).toHaveLength(0); // within grace
    const r1 = evaluateTick(config, sim.state, ctx(256));
    expect(types(r1)).toEqual(['add_time']);
    const again = evaluateTick(config, r1.state, ctx(260));
    expect(again.consequences).toHaveLength(0);
    // Retrying the same tick from the old state produces the same idempotency key
    const retry = evaluateTick(config, sim.state, ctx(257, 'other'));
    expect(retry.consequences[0]!.idempotencyKey).toBe(r1.consequences[0]!.idempotencyKey);
    expect(slot0(r1.state).nextDeadline).toBe(minutes(T0, 480).toISOString());
  });

  it('AC4 catches up multiple missed intervals, capped', () => {
    const sim = new Sim(config);
    const r = evaluateTick(config, sim.state, { now: minutes(T0, 240 * 3 + 20), sessionId: 's1', evalId: 't' });
    expect(r.consequences).toHaveLength(3);
    expect(slot0(r.state).missedCount).toBe(3);
    const far = evaluateTick(config, sim.state, { now: minutes(T0, 240 * 100), sessionId: 's1', evalId: 't' });
    expect(far.consequences).toHaveLength(MAX_MISSED_PER_TICK);
  });

  it('empty zone list means "anywhere"', () => {
    const anywhere = cfg({ rules: { required: { enabled: true, zoneIds: [], onSuccess: [{ type: 'log', message: 'ok' }] } } });
    const sim = new Sim(anywhere);
    expect(types(sim.checkin(BAR, minutes(T0, 5)))).toEqual(['log']);
  });

  it('AC5 quiet hours move the deadline (incl. across midnight)', () => {
    const q = { start: '23:00', end: '07:00' };
    // 23:30 local Zurich (CEST = UTC+2) → 21:30Z
    const d = adjustForQuietHours(new Date('2026-06-01T21:30:00Z'), q, 'Europe/Zurich');
    expect(d.toISOString()).toBe('2026-06-02T05:00:00.000Z'); // 07:00 local
    const early = adjustForQuietHours(new Date('2026-06-02T03:15:20Z'), q, 'Europe/Zurich');
    expect(early.toISOString()).toBe('2026-06-02T05:00:00.000Z');
    const outside = new Date('2026-06-02T08:00:00Z');
    expect(adjustForQuietHours(outside, q, 'Europe/Zurich')).toBe(outside);
    const day = adjustForQuietHours(new Date('2026-06-02T11:00:00Z'), { start: '12:00', end: '14:00' }, 'Europe/Zurich');
    expect(day.toISOString()).toBe('2026-06-02T12:00:00.000Z');
  });
});

describe('F3 forbidden zones', () => {
  const config = cfg({
    zones: [zones.home, zones.bar],
    rules: { forbidden: { enabled: true, zoneIds: ['bar'], cooldownMinutes: 60, onEnter: [addHour, { type: 'pillory', durationMinutes: 30, reason: 'Went to the bar' }] } },
  });
  it('AC1-3 penalises inside, respects cooldown, ignores outside', () => {
    const sim = new Sim(config);
    expect(types(sim.checkin(HOME, minutes(T0, 1)))).toEqual([]);
    expect(types(sim.checkin(BAR, minutes(T0, 10)))).toEqual(['add_time', 'pillory']);
    expect(types(sim.checkin(BAR, minutes(T0, 40)))).toEqual([]);
    expect(types(sim.checkin(BAR, minutes(T0, 75)))).toEqual(['add_time', 'pillory']);
  });
});

describe('F4 reward zones', () => {
  const config = cfg({
    zones: [zones.gym, zones.home],
    rules: { reward: { enabled: true, zoneIds: ['gym', 'home'], cooldownMinutes: 60, maxPerDay: 2, onEnter: [removeHour] } },
  });
  it('AC1-3 reward, cooldown, daily cap and reset', () => {
    const sim = new Sim(config);
    expect(types(sim.checkin(GYM, minutes(T0, 0)))).toEqual(['remove_time']);
    expect(types(sim.checkin(GYM, minutes(T0, 30)))).toEqual([]); // cooldown
    expect(types(sim.checkin(HOME, minutes(T0, 45)))).toEqual(['remove_time']);
    expect(types(sim.checkin(GYM, minutes(T0, 120)))).toEqual([]); // cap of 2 reached
    const nextDay = new Date('2026-06-02T08:00:00Z');
    expect(types(sim.checkin(GYM, nextDay))).toEqual(['remove_time']);
  });
});

describe('F5 travel goals', () => {
  const config = cfg({
    rules: { travel: { enabled: true, stepKm: 1, maxKmPerCheckin: 5, dailyCapKm: 6, onStep: [{ type: 'remove_time', seconds: 600 }, { type: 'log', message: 'step' }] } },
    antiCheat: { maxSpeedKmh: 1000 },
  });
  it('AC1 counts steps, scales time, carries remainder', () => {
    const sim = new Sim(config);
    sim.checkin(HOME, T0);
    const r = sim.checkin(north(HOME, 2500), minutes(T0, 30));
    expect(r.consequences.map((c) => c.consequence)).toEqual([
      { type: 'remove_time', seconds: 1200 },
      { type: 'log', message: 'step' },
    ]);
    expect(sim.state.travel.pendingKm).toBeCloseTo(0.5, 1);
  });
  it('AC2 respects per check-in and daily caps', () => {
    const sim = new Sim(config);
    sim.checkin(HOME, T0);
    sim.checkin(north(HOME, 20_000), minutes(T0, 60)); // capped at 5
    expect(sim.state.travel.totalKm).toBeCloseTo(5, 5);
    sim.checkin(HOME, minutes(T0, 120)); // only 1 left today
    expect(sim.state.travel.totalKm).toBeCloseTo(6, 5);
    const r = sim.checkin(north(HOME, 3000), minutes(T0, 180));
    expect(types(r)).toEqual([]);
  });
  it('AC3 implausible jumps add no distance', () => {
    const strict = cfg({ rules: { travel: { enabled: true, stepKm: 1, onStep: [removeHour] } }, antiCheat: { maxSpeedKmh: 50, onImplausible: 'accept_and_verify' } });
    const sim = new Sim(strict);
    sim.checkin(HOME, T0);
    const r = sim.checkin(north(HOME, 30_000), minutes(T0, 5));
    expect(r.record.flagged).toBe('implausible_speed');
    expect(types(r)).toEqual(['verification_picture']);
    expect(sim.state.travel.totalKm).toBe(0);
  });
});
