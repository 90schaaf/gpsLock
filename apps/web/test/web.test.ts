import { describe, expect, it, vi } from 'vitest';
import { parseHashParams, getStringParam, isDemo } from '../src/lib/hash.js';
import { mapGeoError } from '../src/lib/geolocation.js';
import { ConfigBridge, type BridgeWindow } from '../src/lib/config-bridge.js';
import { HttpBackend, ApiError } from '../src/lib/backend.js';
import { MockBackend, demoConfig } from '../src/lib/mock-backend.js';
import { formatCountdown } from '../src/main/MainApp.js';
import type { ReachStatus } from '../src/lib/reachability.js';

// Leaflet cannot render vector layers in jsdom – the UI smoke tests below use a stub map.
vi.mock('../src/components/LeafletMap.js', async (orig) => ({ ...(await orig<typeof import('../src/components/LeafletMap.js')>()), LeafletMap: () => null }));

describe('F10 AC1 hash parsing', () => {
  it('parses URI-encoded JSON', () => {
    const p = parseHashParams('#%7B%22mainToken%22%3A%22abc%22%7D');
    expect(getStringParam(p, 'mainToken')).toBe('abc');
    expect(getStringParam(parseHashParams('#' + encodeURIComponent(JSON.stringify({ partnerConfigurationToken: 'cfg' }))), 'partnerConfigurationToken')).toBe('cfg');
  });
  it('tolerates garbage', () => {
    expect(parseHashParams('')).toEqual({});
    expect(parseHashParams('#notjson')).toEqual({});
    expect(parseHashParams('#%5B1%5D')).toEqual({});
    expect(getStringParam({ mainToken: 5 }, 'mainToken')).toBeUndefined();
  });
  it('detects demo mode', () => {
    expect(isDemo('?demo')).toBe(true);
    expect(isDemo('?x=1')).toBe(false);
  });
});

describe('F10 AC3 geolocation errors', () => {
  it('maps codes to helpful messages', () => {
    expect(mapGeoError({ code: 1 }, false).code).toBe('denied');
    expect(mapGeoError({ code: 1 }, true).help.join(' ')).toMatch(/new tab/);
    expect(mapGeoError({ code: 1, message: 'permissions policy' }, true).code).toBe('blocked_in_frame');
    expect(mapGeoError({ code: 2 }, false).code).toBe('unavailable');
    expect(mapGeoError({ code: 3 }, false).code).toBe('timeout');
  });
});

function fakeWindow() {
  const sent: any[] = [];
  const listeners: ((e: MessageEvent) => void)[] = [];
  const parent = { postMessage: (m: string) => sent.push(JSON.parse(m)) };
  const win: BridgeWindow = {
    parent,
    addEventListener: (_t, cb) => listeners.push(cb),
    removeEventListener: (_t, cb) => listeners.splice(listeners.indexOf(cb), 1),
  };
  const dispatch = (data: unknown, source: unknown = parent, origin = 'https://chaster.app') =>
    listeners.forEach((l) => l({ data, source, origin } as unknown as MessageEvent));
  return { win, sent, dispatch, listeners };
}

describe('F11 config page postMessage protocol', () => {
  it('AC1 announces capabilities', () => {
    const { win, sent } = fakeWindow();
    new ConfigBridge(win).announce();
    expect(sent).toEqual([{ type: 'partner_configuration', event: 'capabilities', payload: { features: { save: true } } }]);
  });

  it('AC2 save success and failure flows', async () => {
    const { win, sent } = fakeWindow();
    const b = new ConfigBridge(win);
    expect(await b.runSave(async () => undefined)).toBe(true);
    expect(await b.runSave(async () => Promise.reject(new Error('x')))).toBe(false);
    expect(sent.map((s) => s.event)).toEqual(['save_loading', 'save_success', 'save_loading', 'save_failed']);
  });

  it('AC3 only reacts to save requests from the parent / allowed origins', () => {
    const { win, dispatch } = fakeWindow();
    const cb = vi.fn();
    const off = new ConfigBridge(win, ['https://chaster.app']).onSaveRequested(cb);
    const msg = JSON.stringify({ type: 'chaster', event: 'partner_configuration_save' });
    dispatch(msg, {}); // other window
    dispatch(msg, undefined, 'https://evil.example');
    dispatch('not json');
    dispatch(JSON.stringify({ type: 'chaster', event: 'other' }));
    expect(cb).not.toHaveBeenCalled();
    dispatch(msg);
    dispatch({ type: 'chaster', event: 'partner_configuration_save' }); // object payloads also accepted
    expect(cb).toHaveBeenCalledTimes(2);
    off();
  });
});

describe('HttpBackend', () => {
  it('sends tokens, never session ids, and maps errors', async () => {
    const calls: any[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify({ error: { code: 'not_wearer', message: 'Only the wearer can check in.' } }), { status: 403 });
    }) as unknown as typeof fetch;
    const b = new HttpBackend('https://api.test', { mainToken: 'mt' }, fetchImpl);
    await expect(b.checkin({ lat: 1, lng: 2, accuracy: 3, timestamp: 4 }, 'general')).rejects.toMatchObject({ status: 403, code: 'not_wearer' });
    expect(calls[0]).toEqual({ url: 'https://api.test/api/checkin', body: { mainToken: 'mt', fix: { lat: 1, lng: 2, accuracy: 3, timestamp: 4 }, purpose: 'general' } });
    await expect(new HttpBackend('https://api.test', {}).session()).rejects.toBeInstanceOf(ApiError);
  });
});

describe('F13 demo backend', () => {
  const mem = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
  };

  it('runs a full check-in flow with the real engine', async () => {
    let now = new Date('2026-06-01T10:00:00Z');
    const b = new MockBackend(mem(), () => now);
    const cfg = demoConfig();
    const home = cfg.zones[0]!;
    const v = await b.session();
    expect(v.role).toBe('wearer');
    expect(v.rules.map((r) => r.rule)).toEqual(['required', 'forbidden', 'reward', 'travel', 'hunt', 'tracking']);
    const r = await b.checkin({ lat: home.lat, lng: home.lng, accuracy: 5, timestamp: now.getTime() }, 'general');
    expect(r.record.outcome).toBe('accepted');
    expect(r.record.zones).toContain('Home');
    expect(r.view.history).toHaveLength(1);
    // simulate missing the next check-in → cron in demo applies penalty
    now = new Date('2026-06-01T15:00:00Z');
    await b.session();
    expect(b.demoLog().some((l) => /missed/.test(l.description))).toBe(true);
  });

  it('keyholder cannot check in; config save validates and resets', async () => {
    const b = new MockBackend(mem());
    b.setRole('keyholder');
    await expect(b.checkin({ lat: 0, lng: 0, accuracy: 1, timestamp: Date.now() }, 'general')).rejects.toMatchObject({ status: 403 });
    const { config } = await b.configGet();
    await expect(b.configSave({ ...config, zones: [{ id: 'x', name: 'x', lat: 0, lng: 0, radiusM: 1 } as any] })).rejects.toBeInstanceOf(ApiError);
    await expect(b.configSave(config)).rejects.toMatchObject({ code: 'disclaimer_required' });
    await b.configSave({ ...config, disclaimer: { version: 1, acceptedAt: '2026-06-01T00:00:00.000Z' }, rules: { ...config.rules, hunt: { ...config.rules.hunt, enabled: false } } });
    expect((await b.session()).hunt).toBeUndefined();
  });
});

describe('countdown formatting', () => {
  it('formats positive and negative durations', () => {
    expect(formatCountdown(3_661_000)).toBe('01:01:01');
    expect(formatCountdown(-61_000)).toBe('−00:01:01');
    expect(formatCountdown(90_000_000)).toBe('1d 01:00:00');
  });
});

describe('F14 tracking in the demo backend and UI helpers', () => {
  const mem = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
  };

  it('pairs, receives background updates and unpairs', async () => {
    let now = new Date('2026-06-01T10:00:00Z');
    const b = new MockBackend(mem(), () => now);
    const p = await b.pairTracking();
    expect(p.link.startsWith('owntracks:///config?inline=')).toBe(true);
    expect(p.view.tracking?.paired).toBe(true);
    expect(p.view.tracking?.mode).toBe('move'); // auto: forbidden zones enabled
    const casino = demoConfig().zones.find((z) => z.id === 'casino')!;
    const r = await b.track({ lat: casino.lat, lng: casino.lng, accuracy: 10, timestamp: now.getTime() });
    expect(r.record.source).toBe('tracked');
    // v2: forbidden zones escalate – warning after 2 min, first penalty after 10 min
    expect(r.record.consequences).toEqual([]);
    expect(r.view.presentZones).toEqual(['Casino']);
    expect(r.view.forbiddenVisits).toHaveLength(1);
    expect(r.view.forbiddenVisits[0]!.nextPenaltyAt).toBe('2026-06-01T10:10:00.000Z');
    now = new Date('2026-06-01T10:03:00Z');
    await b.session();
    expect(b.demoLog().some((l) => l.title.startsWith('🔔') && /Casino/.test(l.description + l.title))).toBe(true);
    now = new Date('2026-06-01T10:10:30Z');
    const v = await b.session();
    expect(v.forbiddenVisits[0]!.penalties).toBe(1);
    expect(b.demoLog().some((l) => /add 1h/.test(l.description))).toBe(true);
    expect((await b.unpairTracking()).tracking?.paired).toBe(false);
  });

  it('renders a QR code svg', async () => {
    const { qrSvg } = await import('../src/main/TrackingCard.js');
    expect(qrSvg('owntracks:///config?inline=abc')).toMatch(/^<svg/);
  });
});

describe('F16 live tracking only in the demo backend', () => {
  const mem = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
  };

  it('blocks manual check-ins but still accepts background updates', async () => {
    const now = new Date('2026-06-01T10:00:00Z');
    const b = new MockBackend(mem(), () => now);
    const { config } = await b.configGet();
    await b.configSave({ ...config, disclaimer: { version: 1, acceptedAt: '2026-06-01T00:00:00.000Z' }, tracking: { ...config.tracking, checkins: 'auto' } });
    const v = await b.session();
    expect(v.liveOnly).toBe(true);
    const home = config.zones[0]!;
    await expect(b.checkin({ lat: home.lat, lng: home.lng, accuracy: 5, timestamp: now.getTime() }, 'general')).rejects.toMatchObject({ status: 403, code: 'manual_disabled' });
    await b.pairTracking();
    const r = await b.track({ lat: home.lat, lng: home.lng, accuracy: 10, timestamp: now.getTime() });
    expect(r.record.outcome).toBe('accepted');
  });
});

describe('travel tab example', () => {
  it('explains step size vs. max per check-in with the current values', async () => {
    const { travelExample } = await import('../src/config/ConfigApp.js');
    expect(travelExample(1, 3)).toBe(
      'Example: moving 2.5 km between two check-ins counts 2.5 km → 2 rewards, 0.5 km carried over. A 40 km train ride counts only 3 km → 3 rewards.',
    );
    expect(travelExample(2, 3)).toBe(
      'Example: moving 5 km between two check-ins counts 3 km → 1 reward, 1 km carried over. A 40 km train ride counts only 3 km → 1 reward.',
    );
    expect(travelExample(0, 3)).toBe('');
  });
});

describe('tracking card status badge', () => {
  it('shows the real connection state', async () => {
    const { h, render } = await import('preact');
    const { TrackingCard } = await import('../src/main/TrackingCard.js');
    const b = new MockBackend((() => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }; })());
    const el = document.createElement('div');
    const show = (view: any) => {
      render(h(TrackingCard, { view, backend: b, onView: () => undefined, onError: () => undefined }), el);
      return el.querySelector('[data-testid="tracking-status"]')!.textContent;
    };
    const t = { paired: true, overdue: false, missedCount: 0, heartbeatMinutes: 20, updates: 0 };
    const v = { role: 'wearer', presentZones: [] };
    expect(show({ ...v, tracking: { ...t, status: 'waiting' } })).toBe('waiting for first location');
    expect(show({ ...v, tracking: { ...t, status: 'connected' } })).toBe('connected');
    expect(show({ ...v, tracking: { ...t, paired: false, status: 'not_set_up' } })).toBe('not set up');
  });
});

const memStore = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
};
const DISCLAIMER = { version: 1, acceptedAt: '2026-06-01T00:00:00.000Z' };

describe('zone roles (config page helpers)', () => {
  it('allows required and/or reward, or forbidden, or neutral', async () => {
    const { toggleRole, isValidRoleSet } = await import('../src/config/helpers.js');
    expect(toggleRole([], 'required')).toEqual(['required']);
    expect(toggleRole(['required'], 'reward')).toEqual(['required', 'reward']);
    expect(toggleRole(['reward'], 'required')).toEqual(['required', 'reward']);
    expect(toggleRole(['required', 'reward'], 'required')).toEqual(['reward']);
    expect(toggleRole(['required', 'reward'], 'forbidden')).toEqual(['forbidden']);
    expect(toggleRole(['forbidden'], 'reward')).toEqual(['reward']);
    expect(toggleRole(['forbidden'], 'forbidden')).toEqual([]);
    expect(toggleRole(['required', 'reward'], 'neutral')).toEqual([]);
    for (const start of [[], ['required'], ['reward'], ['required', 'reward'], ['forbidden']] as const) {
      for (const c of ['required', 'reward', 'forbidden', 'neutral'] as const) expect(isValidRoleSet(toggleRole(start, c))).toBe(true);
    }
    expect(isValidRoleSet(['forbidden', 'reward'])).toBe(false);
  });

  it('drops the settings of removed roles and suggests strict matching for forbidden zones', async () => {
    const { applyRoles, droppedRolesWithSettings, hasRoleSettings } = await import('../src/config/helpers.js');
    const cfg = demoConfig();
    const home = cfg.zones.find((z) => z.id === 'home')!; // required with a stay window
    expect(hasRoleSettings(home, 'required')).toBe(true);
    expect(droppedRolesWithSettings(home, ['forbidden'])).toEqual(['required']);
    const f = applyRoles(home, ['forbidden']);
    expect(f.roles).toEqual(['forbidden']);
    expect(f.required.stayWindows).toEqual([]);
    expect(f.matchMode).toBe('strict');
    expect(home.roles).toEqual(['required']); // input untouched
    const casino = cfg.zones.find((z) => z.id === 'casino')!; // forbidden without own settings
    expect(droppedRolesWithSettings(casino, [])).toEqual([]);
    expect(applyRoles({ ...casino, roles: [], matchMode: 'lenient' }, ['forbidden']).matchMode).toBe('lenient'); // explicit mode kept
  });

  it('describes the forbidden-zone timeline', async () => {
    const { forbiddenTimeline, penaltiesForStay } = await import('../src/config/helpers.js');
    const t = { firstWarning: 2, firstPenalty: 10, repeatEvery: 5, repeatWarning: 1 };
    expect(penaltiesForStay(t, 60)).toBe(11);
    expect(penaltiesForStay(t, 9)).toBe(0);
    expect(forbiddenTimeline(t)).toBe('enter 0′ → ⚠ 2′ → ❌ 10′ → ⚠ 11′ → ❌ 15′ → ⚠ 16′ → ❌ 20′ → … – 1 h inside = 11 penalties');
    expect(forbiddenTimeline({ ...t, firstWarning: null, repeatWarning: null, repeatEvery: 30 })).toBe('enter 0′ → ❌ 10′ → ❌ 40′ → ❌ 70′ → … – 1 h inside = 2 penalties');
  });
});

describe('F17 reachability check', () => {
  const place = { lat: 47.0, lng: 8.0, radiusM: 100 };

  it('samples the centre and 8 points at 0.7 × radius', async () => {
    const { samplePoints } = await import('../src/lib/reachability.js');
    const { haversineM } = await import('@lockation/core');
    const s = samplePoints(place);
    expect(s).toHaveLength(9);
    expect(s[0]).toEqual({ lat: 47, lng: 8 });
    for (const p of s.slice(1)) expect(haversineM(place, p)).toBeCloseTo(70, 0);
  });

  it('classifies all / some / no failing samples', async () => {
    const { classifyReachability } = await import('../src/lib/reachability.js');
    const lake = Array.from({ length: 9 }, () => ['in a lake']);
    expect(classifyReachability(lake)).toEqual({ state: 'out_of_reach', reasons: ['in a lake'] });
    expect(classifyReachability([['in a lake'], ...Array.from({ length: 8 }, () => [])])).toEqual({ state: 'partly', reasons: ['in a lake'] });
    expect(classifyReachability(Array.from({ length: 9 }, () => []))).toEqual({ state: 'ok' });
    expect(classifyReachability(Array.from({ length: 9 }, () => []), ['no road or path nearby'])).toEqual({ state: 'out_of_reach', reasons: ['no road or path nearby'] });
    const mixed = [...Array.from({ length: 5 }, () => ['on a glacier']), ...Array.from({ length: 4 }, () => ['in a lake'])];
    expect(classifyReachability(mixed)).toEqual({ state: 'out_of_reach', reasons: ['in a lake', 'on a glacier'] });
  });

  const overpassResponse = (sampleAreas: (Record<string, string> | null)[], opts: { ways?: number; centre?: Record<string, string>[] } = {}) => ({
    elements: [
      ...sampleAreas.flatMap((tags, n) => [
        { type: 'sample', id: n + 1, tags: { n: String(n) } },
        { type: 'area', id: 3600000001, tags: { boundary: 'administrative', name: 'Somewhere' } },
        ...(tags ? [{ type: 'area', id: 3600000002 + n, tags }] : []),
      ]),
      { type: 'centre', id: 100, tags: {} },
      ...(opts.centre ?? []).map((tags, i) => ({ type: 'way', id: 200 + i, tags })),
      { type: 'access', id: 101, tags: {} },
      { type: 'count', id: 0, tags: { nodes: '0', ways: String(opts.ways ?? 3), relations: '0', areas: '0', total: String(opts.ways ?? 3) } },
    ],
  });

  it('parses the combined Overpass response', async () => {
    const { parseOverpass, overpassQuery } = await import('../src/lib/reachability.js');
    expect(overpassQuery(place)).toMatch(/is_in\(47\.000000,8\.000000\)->\.a0;/);
    expect(overpassQuery(place)).toMatch(/way\(around:200,47\.000000,8\.000000\)\[highway\];out count;/);
    const r = parseOverpass(overpassResponse([{ natural: 'water', water: 'lake' }, { landuse: 'military' }, null, null, null, null, null, null, null], { ways: 0, centre: [{ railway: 'rail' }] }));
    expect(r.samples[0]).toEqual(['in a lake']);
    expect(r.samples[1]).toEqual(['in a military area']);
    expect(r.samples[2]).toEqual([]);
    expect(r.centre).toEqual(['on a railway', 'no road or path nearby']);
    expect(() => parseOverpass({ elements: [] })).toThrow();
  });

  it('checks with injected fetch, caches results and reports failures as "could not be checked"', async () => {
    const { createReachabilityChecker } = await import('../src/lib/reachability.js');
    const calls: string[] = [];
    const lake = overpassResponse(Array.from({ length: 9 }, () => ({ natural: 'water' })));
    const fetchImpl = (async (url: string) => {
      calls.push(url);
      if (url.includes('overpass')) return new Response(JSON.stringify(lake));
      return new Response(JSON.stringify({ address: { country_code: 'ch' } }));
    }) as unknown as typeof fetch;
    const storage = memStore();
    let t = 0;
    const sleeps: number[] = [];
    const check = createReachabilityChecker({ fetch: fetchImpl, storage, now: () => t, sleep: async (ms) => { sleeps.push(ms); t += ms; } });
    expect(await check(place)).toEqual({ state: 'out_of_reach', reasons: ['in a lake'] });
    expect(calls).toHaveLength(2);
    expect(await check(place)).toEqual({ state: 'out_of_reach', reasons: ['in a lake'] }); // cached
    expect(calls).toHaveLength(2);
    await check({ ...place, lat: 46.5 }); // Nominatim ≤ 1 request per second
    expect(sleeps.some((s) => s >= 1000)).toBe(true);
    const sea = createReachabilityChecker({
      fetch: (async (url: string) => new Response(JSON.stringify(url.includes('overpass') ? overpassResponse(Array.from({ length: 9 }, () => null)) : { error: 'Unable to geocode' }))) as unknown as typeof fetch,
      storage: null,
      sleep: async () => undefined,
    });
    expect(await sea(place)).toEqual({ state: 'out_of_reach', reasons: ['offshore'] });
    const broken = createReachabilityChecker({ fetch: (async () => { throw new Error('offline'); }) as unknown as typeof fetch, storage: null, sleep: async () => undefined });
    expect(await broken(place)).toEqual({ state: 'unknown' });
  });

  it('invalidates a confirmation when the reasons change and blocks saving while a flagged place is unconfirmed', async () => {
    const { ackStillValid, unconfirmedPlaces } = await import('../src/lib/reachability.js');
    const ack = { reasons: ['in a lake'], at: '2026-06-01T00:00:00Z' };
    expect(ackStillValid(ack, { state: 'out_of_reach', reasons: ['in a lake'] })).toBe(true);
    expect(ackStillValid(ack, { state: 'out_of_reach', reasons: ['on a glacier'] })).toBe(false);
    expect(ackStillValid(ack, { state: 'ok' })).toBe(false);
    expect(ackStillValid(ack, { state: 'unknown' })).toBe(true);
    expect(ackStillValid(ack, { state: 'pending' })).toBe(true);
    const places = [
      { id: 'a', name: 'Lake', reachabilityAck: ack },
      { id: 'b', name: 'Glacier' },
      { id: 'c', name: 'Park' },
      { id: 'd', name: 'Offline' },
    ];
    const statuses = {
      a: { state: 'out_of_reach', reasons: ['in a lake'] },
      b: { state: 'out_of_reach', reasons: ['on a glacier'] },
      c: { state: 'partly', reasons: ['in a lake'] },
      d: { state: 'unknown' },
    } as Record<string, ReachStatus>;
    expect(unconfirmedPlaces(places, statuses)).toEqual([{ id: 'b', name: 'Glacier', reasons: ['on a glacier'] }]);
    expect(unconfirmedPlaces([{ ...places[1]!, reachabilityAck: { reasons: ['on a glacier'], at: 'x' } }], statuses)).toEqual([]);
  });
});

describe('demo backend v2', () => {
  it('sets up and stops notifications per role', async () => {
    const b = new MockBackend(memStore(), () => new Date('2026-06-01T10:00:00Z'));
    expect((await b.session()).notifications).toEqual({ available: true, subscribed: false });
    const s = await b.setupNotifications();
    expect(s.url).toBe(`https://ntfy.sh/${s.topic}`);
    expect(s.deepLink).toBe(`ntfy://ntfy.sh/${s.topic}`);
    expect(s.view.notifications?.subscribed).toBe(true);
    b.setRole('keyholder');
    expect((await b.session()).notifications?.subscribed).toBe(false);
    b.setRole('wearer');
    expect((await b.stopNotifications()).notifications?.subscribed).toBe(false);
  });

  it('announces config changes during the demo lock until the wearer acknowledges them', async () => {
    const b = new MockBackend(memStore(), () => new Date('2026-06-01T10:00:00Z'));
    expect((await b.session()).rulesChanged).toBeUndefined();
    const { config } = await b.configGet();
    await b.configSave({ ...config, disclaimer: DISCLAIMER }); // only the disclaimer changed → no summary
    expect((await b.session()).rulesChanged).toBeUndefined();
    const zones = config.zones.map((z) => (z.id === 'home' ? { ...z, required: { ...z.required, intervalMinutes: 120 } } : z));
    await b.configSave({ ...config, disclaimer: DISCLAIMER, zones });
    const v = await b.session();
    expect(v.rulesChanged?.summary.join(' ')).toMatch(/Home.*interval 4h → 2h/);
    expect(b.demoLog().map((l) => l.title)).toContain('Lockation rules changed');
    b.setRole('keyholder');
    await expect(b.ackRulesChanged()).rejects.toMatchObject({ status: 403 });
    b.setRole('wearer');
    expect((await b.ackRulesChanged()).rulesChanged).toBeUndefined();
    expect((await b.session()).rulesChanged).toBeUndefined();
  });

  it('shows all hunt checkpoints with reveal "all" and disables guesses', async () => {
    let now = new Date('2026-06-01T10:00:00Z');
    const b = new MockBackend(memStore(), () => now);
    const v = await b.session();
    expect(v.hunt?.reveal).toBe('all');
    expect(v.hunt?.guessesAllowed).toBe(false);
    expect(v.hunt?.checkpoints.map((c) => [c.name, c.status])).toEqual([['North', 'current'], ['East', 'upcoming']]);
    const cp1 = demoConfig().rules.hunt.checkpoints[0]!;
    now = new Date('2026-06-01T10:01:00Z');
    const r = await b.checkin({ lat: cp1.lat, lng: cp1.lng, accuracy: 5, timestamp: now.getTime() }, 'general');
    expect(r.view.hunt?.checkpoints.map((c) => c.status)).toEqual(['found', 'current']);
  });

  it('lists required slots and zone windows', async () => {
    const b = new MockBackend(memStore(), () => new Date('2026-06-01T10:00:00Z'));
    const v = await b.session();
    expect(v.requiredSlots?.map((s) => s.name)).toEqual(['Home']);
    expect(v.zones.find((z) => z.id === 'home')?.windows).toEqual(['Stay inside 23:00–06:00']);
    expect(v.zones.find((z) => z.id === 'bar')?.windows).toEqual(['Forbidden 20:00–02:00']);
  });
});

describe('UI smoke tests (jsdom)', () => {
  const setup = () => {
    (globalThis as any).ResizeObserver ??= class { observe() {} disconnect() {} unobserve() {} };
    (globalThis as any).confirm = () => true;
  };
  const flush = () => new Promise((r) => setTimeout(r, 150));

  it('renders the check-in page with the v2 demo', async () => {
    setup();
    const { h, render } = await import('preact');
    const { MainApp } = await import('../src/main/MainApp.js');
    const b = new MockBackend(memStore(), () => new Date('2026-06-01T10:00:00Z'));
    const { config } = await b.configGet();
    await b.session();
    await b.configSave({ ...config, disclaimer: DISCLAIMER, zones: config.zones.map((z) => (z.id === 'home' ? { ...z, radiusM: 200 } : z)) });
    const el = document.createElement('div');
    document.body.appendChild(el);
    render(h(MainApp, { backend: b, mock: b }), el);
    await flush();
    expect(el.querySelector('[data-testid="hunt-checkpoints"]')?.querySelectorAll('li')).toHaveLength(2);
    expect(el.querySelector('[data-testid="rules-changed"]')?.textContent).toMatch(/radius 150 m → 200 m/);
    expect(el.querySelectorAll('[data-testid="zone-window"]').length).toBe(2);
    expect(el.textContent).not.toMatch(/Submit hunt guess/);
    (el.querySelector('[data-testid="notify-setup"]') as HTMLButtonElement).click();
    await flush();
    expect(el.querySelector('[data-testid="notify-topic"]')?.textContent).toMatch(/^lockation-demo-wearer-/);
    (el.querySelector('[data-testid="rules-changed-ok"]') as HTMLButtonElement).click();
    await flush();
    expect(el.querySelector('[data-testid="rules-changed"]')).toBeNull();
    render(null, el);
  });

  it('renders the config page, flags unreachable places and blocks saving until confirmed', async () => {
    setup();
    const { h, render } = await import('preact');
    const { ConfigApp } = await import('../src/config/ConfigApp.js');
    const b = new MockBackend(memStore());
    const { config } = await b.configGet();
    await b.configSave({ ...config, disclaimer: DISCLAIMER });
    const { win } = fakeWindow();
    const bridge = new ConfigBridge(win);
    const reachCheck = async (p: { lat: number }): Promise<ReachStatus> =>
      p.lat === config.zones[0]!.lat ? { state: 'out_of_reach', reasons: ['in a lake'] } : { state: 'ok' };
    const el = document.createElement('div');
    document.body.appendChild(el);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(h(ConfigApp, { backend: b, bridge, reachCheck }), el);
    await vi.advanceTimersByTimeAsync(200);
    expect(el.querySelectorAll('[data-testid="zone-item"]')).toHaveLength(4);
    await vi.advanceTimersByTimeAsync(1500);
    expect(el.querySelector('[data-testid="reach-flag"]')?.textContent).toMatch(/in a lake/);
    expect(el.querySelector('[data-testid="reach-blocker"]')).not.toBeNull();
    const ok = await bridge.runSave(async () => {
      throw new Error('unused');
    });
    expect(ok).toBe(false);
    (el.querySelector('[data-testid="reach-ack-all"]') as HTMLInputElement).click(); // one confirmation for all flagged places
    await vi.advanceTimersByTimeAsync(200);
    expect(el.querySelector('[data-testid="reach-blocker"]')).toBeNull();
    // Required tab lists only required zones
    const tabBtn = [...el.querySelectorAll('.tabs button')].find((x) => x.textContent?.includes('Required')) as HTMLButtonElement;
    tabBtn.click();
    await vi.advanceTimersByTimeAsync(200);
    expect([...el.querySelectorAll('[data-testid="required-zone"] summary strong')].map((x) => x.textContent)).toEqual(['Home']);
    vi.useRealTimers();
    render(null, el);
  });

  it('shows errors on their tab and field instead of a list on top', async () => {
    setup();
    const { h, render } = await import('preact');
    const { ConfigApp } = await import('../src/config/ConfigApp.js');
    const b = new MockBackend(memStore());
    const { config } = await b.configGet();
    await b.configSave({ ...config, disclaimer: DISCLAIMER });
    const { win } = fakeWindow();
    const el = document.createElement('div');
    document.body.appendChild(el);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(h(ConfigApp, { backend: b, bridge: new ConfigBridge(win), reachCheck: async () => ({ state: 'ok' }) as ReachStatus }), el);
    await vi.advanceTimersByTimeAsync(200);
    const name = el.querySelector('input[aria-label="zone name"]') as HTMLInputElement;
    name.value = '';
    name.dispatchEvent(new Event('input', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(100);
    expect(el.querySelector('[data-testid="tab-issues-zones"]')?.textContent).toMatch(/1/);
    expect(el.querySelector('[data-testid="tab-issues"]')?.textContent).toMatch(/Zone 1 › Name|› Name/);
    expect(el.querySelector('[data-testid="issue-summary"]')?.textContent).toMatch(/1 problem to fix/);
    // forbidden rule: first warning not before the first penalty → inline at the field, on the Forbidden tab
    name.value = 'Home';
    name.dispatchEvent(new Event('input', { bubbles: true }));
    (([...el.querySelectorAll('.tabs button')].find((x) => x.textContent?.includes('Forbidden'))) as HTMLButtonElement).click();
    await vi.advanceTimersByTimeAsync(100);
    const warn = el.querySelector('input[aria-label="First warning (minutes)"]') as HTMLInputElement;
    warn.value = '30';
    warn.dispatchEvent(new Event('input', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(100);
    expect(el.querySelector('.field.invalid .field-error')?.textContent).toMatch(/before the first penalty/);
    expect(el.querySelector('[data-testid="tab-issues-forbidden"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="tab-issues"]')).toBeNull(); // shown at the field, not listed again
    vi.useRealTimers();
    render(null, el);
  });

  it('shows the disclaimer only on the Zones tab until accepted; adding places needs it', async () => {
    setup();
    const { h, render } = await import('preact');
    const { ConfigApp } = await import('../src/config/ConfigApp.js');
    const b = new MockBackend(memStore());
    const { win } = fakeWindow();
    const bridge = new ConfigBridge(win);
    const el = document.createElement('div');
    document.body.appendChild(el);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(h(ConfigApp, { backend: b, bridge, reachCheck: async () => ({ state: 'ok' }) as ReachStatus }), el);
    await vi.advanceTimersByTimeAsync(200);
    const card = el.querySelector('[data-testid="disclaimer"]');
    expect(card).not.toBeNull();
    expect(el.querySelector('input[placeholder*="address" i]')).toBeNull(); // no address search yet
    (card!.querySelector('input[type="checkbox"]') as HTMLInputElement).click();
    await vi.advanceTimersByTimeAsync(200);
    expect(el.querySelector('[data-testid="disclaimer"]')).toBeNull();
    const huntTab = [...el.querySelectorAll('.tabs button')].find((x) => x.textContent?.includes('Hunt')) as HTMLButtonElement;
    huntTab.click();
    await vi.advanceTimersByTimeAsync(200);
    expect(el.querySelector('[data-testid="disclaimer"]')).toBeNull();
    expect(el.querySelector('[data-testid="disclaimer-hint"]')).toBeNull();
    vi.useRealTimers();
    render(null, el);
  });
});

describe('signal countdown', () => {
  it('counts down to the expected location and up when delayed', async () => {
    const { h, render } = await import('preact');
    const { SignalCountdown } = await import('../src/main/TrackingCard.js');
    const el = document.createElement('div');
    const due = '2026-06-01T10:20:00.000Z';
    const view: any = { timezone: 'UTC', tracking: { paired: true, signalDueAt: due, nextHeartbeat: '2026-06-01T10:40:00.000Z' } };
    const show = (now: string) => {
      render(h(SignalCountdown, { view, nowMs: Date.parse(now) }), el);
      return el.textContent ?? '';
    };
    expect(show('2026-06-01T10:15:30.000Z')).toMatch(/Next location expected by .* in 00:04:30/);
    const late = show('2026-06-01T10:27:41.000Z');
    expect(late).toMatch(/Location delayed by 00:07:41/);
    expect(late).toMatch(/next missing-signal penalty .* in 00:12:19/);
    view.tracking.paired = false;
    expect(show('2026-06-01T10:15:00.000Z')).toBe('');
    render(null, el);
  });
});

describe('inline validation', () => {
  it('assigns issues to tabs and gives readable labels', async () => {
    const { issueTab, issueLabel } = await import('../src/config/issues.js');
    const cfg = demoConfig();
    const bar = cfg.zones.findIndex((z) => z.roles.includes('forbidden'));
    expect(issueTab(`zones.${bar}.forbidden.firstWarningAfterMinutes`)).toBe('forbidden');
    expect(issueTab('zones.0.name')).toBe('zones');
    expect(issueTab('tracking.warnBeforeMinutes')).toBe('tracking');
    expect(issueTab('antiCheat.maxAccuracyM')).toBe('anticheat');
    expect(issueLabel(`zones.${bar}.forbidden.firstWarningAfterMinutes`, cfg)).toBe(`${cfg.zones[bar]!.name} › First warning`);
    expect(issueLabel(`zones.${bar}.forbidden.onEnter.1.seconds`, cfg)).toBe(`${cfg.zones[bar]!.name} › Extra consequences #2 › Time`);
    expect(issueLabel('rules.hunt.checkpoints.0.radiusM', cfg)).toBe(`${cfg.rules.hunt.checkpoints[0]!.name} › Radius`);
    expect(issueLabel('rules.forbidden.enabled', cfg)).toBe('');
  });

});

describe('hunt control, test notification, setup confirmation, settings file (demo)', () => {
  const mem = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
  };
  const DISC = { version: 1, acceptedAt: '2026-06-01T00:00:00.000Z' };

  it('keyholder-started hunt: wearer cannot start, keyholder can; pause by keyholder', async () => {
    const b = new MockBackend(mem());
    const { config } = await b.configGet();
    await b.configSave({ ...config, disclaimer: DISC, rules: { ...config.rules, hunt: { ...config.rules.hunt, start: 'keyholder' } } });
    b.setRole('wearer');
    let v = await b.session();
    expect(v.hunt).toMatchObject({ status: 'not_started', actions: [] });
    await expect(b.huntAction('start')).rejects.toMatchObject({ status: 403 });
    b.setRole('keyholder');
    v = await b.huntAction('start');
    expect(v.hunt?.status).toBe('active');
    v = await b.huntAction('pause');
    expect(v.hunt).toMatchObject({ status: 'paused', actions: ['resume', 'abort'] });
  });

  it('test notification needs a subscription; demo track() confirms the tracking setup', async () => {
    const b = new MockBackend(mem());
    await expect(b.testNotification()).rejects.toMatchObject({ status: 409 });
    await b.setupNotifications();
    await expect(b.testNotification()).resolves.toEqual({ ok: true });
    expect(b.demoLog().some((l) => /test notification/.test(l.title))).toBe(true);
    await b.pairTracking();
    expect((await b.session()).tracking?.status).toBe('waiting');
    const home = (await b.configGet()).config.zones[0]!;
    await b.track({ lat: home.lat, lng: home.lng, accuracy: 10, timestamp: Date.now() });
    expect((await b.session()).tracking?.status).toBe('connected');
  });

  it('settings file: export/import round trip, invalid files rejected', async () => {
    const { importConfigText } = await import('../src/config/ConfigApp.js');
    const cfg = demoConfig();
    const ok = importConfigText(JSON.stringify(cfg));
    expect(ok.ok && ok.config.zones.map((z) => z.name)).toEqual(cfg.zones.map((z) => z.name));
    expect(importConfigText('not json')).toMatchObject({ ok: false, error: expect.stringContaining('not JSON') });
    const bad = importConfigText(JSON.stringify({ ...cfg, zones: [{ ...cfg.zones[0], radiusM: 1 }] }));
    expect(bad).toMatchObject({ ok: false, error: expect.stringMatching(/Radius/) });
  });
});

describe('check-in mode selector', () => {
  it('maps tracking on/off and checkins to one mode and back', async () => {
    const { checkinMode, setCheckinMode } = await import('../src/config/ConfigApp.js');
    const c = demoConfig();
    setCheckinMode(c, 'manual');
    expect([c.tracking.enabled, checkinMode(c.tracking)]).toEqual([false, 'manual']);
    setCheckinMode(c, 'auto');
    expect([c.tracking.enabled, c.tracking.checkins, checkinMode(c.tracking)]).toEqual([true, 'auto', 'auto']);
    c.antiCheat.liveVerificationEveryHours = 4;
    setCheckinMode(c, 'both');
    expect([c.tracking.checkins, c.antiCheat.liveVerificationEveryHours]).toEqual(['both', undefined]);
  });
});

describe('demo: map clicks as fake background locations', () => {
  it('accepts far jumps when sent from a map click (speed check off), rejects them otherwise', async () => {
    const m = new Map<string, string>();
    const b = new MockBackend({ getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) });
    await b.pairTracking();
    const z = (await b.configGet()).config.zones;
    const t = Date.now();
    await b.track({ lat: z[0]!.lat, lng: z[0]!.lng, accuracy: 10, timestamp: t }, { ignoreSpeed: true });
    const far = { lat: z[0]!.lat + 0.5, lng: z[0]!.lng, accuracy: 10, timestamp: t + 2000 };
    expect((await b.track(far, { ignoreSpeed: true })).record.outcome).toBe('accepted');
    const back = { lat: z[0]!.lat, lng: z[0]!.lng, accuracy: 10, timestamp: t + 4000 };
    expect((await b.track(back)).record.reason).toBe('implausible_speed');
  });
});
