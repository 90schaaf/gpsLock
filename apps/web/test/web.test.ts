import { describe, expect, it, vi } from 'vitest';
import { parseHashParams, getStringParam, isDemo } from '../src/lib/hash.js';
import { mapGeoError } from '../src/lib/geolocation.js';
import { ConfigBridge, type BridgeWindow } from '../src/lib/config-bridge.js';
import { HttpBackend, ApiError } from '../src/lib/backend.js';
import { MockBackend, demoConfig } from '../src/lib/mock-backend.js';
import { formatCountdown } from '../src/main/MainApp.js';

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
    expect(v.rules.map((r) => r.rule)).toEqual(["required", "forbidden", "reward", "travel", "hunt", "curfew", "tracking"]);
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
    await expect(b.configSave({ ...config, zones: [{ id: 'x', name: 'x', lat: 0, lng: 0, radiusM: 1 }] })).rejects.toBeInstanceOf(ApiError);
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
    const now = new Date('2026-06-01T10:00:00Z');
    const b = new MockBackend(mem(), () => now);
    const p = await b.pairTracking();
    expect(p.link.startsWith('owntracks:///config?inline=')).toBe(true);
    expect(p.view.tracking?.paired).toBe(true);
    const bar = demoConfig().zones[2]!;
    const r = await b.track({ lat: bar.lat, lng: bar.lng, accuracy: 10, timestamp: now.getTime() });
    expect(r.record.source).toBe('tracked');
    expect(r.record.consequences.map((c) => c.type)).toEqual(['add_time', 'pillory']);
    expect(r.view.presentZones).toEqual(['Bar']);
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
    await b.configSave({ ...config, disclaimer: { version: 1, acceptedAt: '2026-06-01T00:00:00.000Z' }, tracking: { ...config.tracking, liveOnly: true } });
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
