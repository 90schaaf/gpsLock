import { describe, expect, it } from 'vitest';
import { distanceBand, haversineM, isInside, parseConfig, roundCoord, defaultConfig, ConsequenceSchema } from '../src/index.js';
import { BERN, HOME, north } from './helpers.js';

describe('F1 geo', () => {
  it('AC1 haversine matches reference distances', () => {
    expect(haversineM(HOME, HOME)).toBe(0);
    const d = haversineM(HOME, BERN);
    expect(d / 1000).toBeGreaterThan(95.5 * 0.995);
    expect(d / 1000).toBeLessThan(95.5 * 1.005);
    expect(haversineM(HOME, north(HOME, 1000))).toBeCloseTo(1000, -1);
  });

  it('AC2 lenient vs strict matching at the border', () => {
    const circle = { ...HOME, radiusM: 100 };
    const onBorder = { ...north(HOME, 99.9), accuracy: 20 };
    expect(isInside(onBorder, circle, 'lenient')).toBe(true);
    expect(isInside(onBorder, circle, 'strict')).toBe(false);
    const centre = { ...north(HOME, 50), accuracy: 20 };
    expect(isInside(centre, circle, 'strict')).toBe(true);
    expect(isInside({ ...north(HOME, 150), accuracy: 5 }, circle, 'lenient')).toBe(false);
  });

  it('distance bands and rounding', () => {
    expect(distanceBand(10)).toBe('<200m');
    expect(distanceBand(450)).toBe('<500m');
    expect(distanceBand(999)).toBe('<1km');
    expect(distanceBand(4000)).toBe('<5km');
    expect(distanceBand(9000)).toBe('>5km');
    expect(roundCoord(47.376912)).toBe(47.377);
  });
});

describe('F1/F11 config validation', () => {
  it('fills defaults for an empty config', () => {
    const c = defaultConfig('Europe/Zurich');
    expect(c.version).toBe(1);
    expect(c.privacy.coordinates).toBe('zone_only');
    expect(c.antiCheat.maxAccuracyM).toBe(100);
    expect(c.rules.required.enabled).toBe(false);
  });

  it('AC3 rejects too small / too large radius and duplicate ids', () => {
    const small = parseConfig({ zones: [{ id: 'a', name: 'A', lat: 0, lng: 0, radiusM: 10 }] });
    expect(small.ok).toBe(false);
    const big = parseConfig({ zones: [{ id: 'a', name: 'A', lat: 0, lng: 0, radiusM: 60_000 }] });
    expect(big.ok).toBe(false);
    const dup = parseConfig({
      zones: [
        { id: 'a', name: 'A', lat: 0, lng: 0, radiusM: 100 },
        { id: 'a', name: 'B', lat: 1, lng: 1, radiusM: 100 },
      ],
    });
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.issues[0]!.message).toMatch(/duplicate/);
  });

  it('rejects unknown zone references, bad timezone and required+forbidden overlap', () => {
    const z = [{ id: 'a', name: 'A', lat: 0, lng: 0, radiusM: 100 }];
    expect(parseConfig({ zones: z, rules: { required: { enabled: true, zoneIds: ['x'] } } }).ok).toBe(false);
    expect(parseConfig({ timezone: 'Mars/Olympus' }).ok).toBe(false);
    expect(
      parseConfig({ zones: z, rules: { required: { enabled: true, zoneIds: ['a'] }, forbidden: { enabled: true, zoneIds: ['a'] } } }).ok,
    ).toBe(false);
    expect(parseConfig({ rules: { hunt: { enabled: true } } }).ok).toBe(false);
  });

  it('F7 consequence schema validates ranges and command ids', () => {
    expect(ConsequenceSchema.safeParse({ type: 'add_time', seconds: 3600 }).success).toBe(true);
    expect(ConsequenceSchema.safeParse({ type: 'add_time', seconds: 0 }).success).toBe(false);
    expect(ConsequenceSchema.safeParse({ type: 'pillory', durationMinutes: 2, reason: 'x' }).success).toBe(false);
    expect(ConsequenceSchema.safeParse({ type: 'command', commandId: 'tasks.assign', input: {} }).success).toBe(true);
    expect(ConsequenceSchema.safeParse({ type: 'command', commandId: 'nope' }).success).toBe(false);
  });
});

describe('place limit', () => {
  const zone = (i: number) => ({ id: `z${i}`, name: `Z${i}`, lat: 47 + i / 100, lng: 8, radiusM: 100 });
  const cp = (i: number) => ({ id: `c${i}`, name: `C${i}`, lat: 46 + i / 100, lng: 8, radiusM: 80, hint: '' });
  it('allows at most 20 zones and hunt checkpoints in total', () => {
    const ok = parseConfig({ zones: Array.from({ length: 15 }, (_, i) => zone(i)), rules: { hunt: { checkpoints: Array.from({ length: 5 }, (_, i) => cp(i)) } } });
    expect(ok.ok).toBe(true);
    const tooMany = parseConfig({ zones: Array.from({ length: 15 }, (_, i) => zone(i)), rules: { hunt: { checkpoints: Array.from({ length: 6 }, (_, i) => cp(i)) } } });
    expect(tooMany.ok).toBe(false);
    if (!tooMany.ok) expect(JSON.stringify(tooMany.issues)).toMatch(/at most 20 zones and hunt checkpoints in total \(currently 21\)/);
    expect(parseConfig({ zones: Array.from({ length: 21 }, (_, i) => zone(i)) }).ok).toBe(false);
  });
});

describe('disclaimer', () => {
  it('is optional for parsing but checked by disclaimerAccepted', async () => {
    const { disclaimerAccepted, DISCLAIMER_VERSION } = await import('../src/index.js');
    const old = parseConfig({});
    expect(old.ok).toBe(true);
    if (old.ok) expect(disclaimerAccepted(old.config)).toBe(false);
    expect(disclaimerAccepted({ disclaimer: { version: DISCLAIMER_VERSION, acceptedAt: '2026-11-23T00:00:00Z' } })).toBe(true);
    expect(disclaimerAccepted({ disclaimer: { version: DISCLAIMER_VERSION - 1 || 0, acceptedAt: 'x' } } as any)).toBe(false);
  });
});

describe('radius limits', () => {
  it('accepts 20 m and rejects smaller radii', () => {
    const z = (r: number) => ({ zones: [{ id: 'a', name: 'A', lat: 47, lng: 8, radiusM: r }] });
    expect(parseConfig(z(20)).ok).toBe(true);
    expect(parseConfig(z(19)).ok).toBe(false);
  });
});
