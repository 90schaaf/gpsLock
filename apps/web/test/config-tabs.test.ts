import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfigBridge, type BridgeWindow } from '../src/lib/config-bridge.js';
import { MockBackend } from '../src/lib/mock-backend.js';
import type { ReachStatus } from '../src/lib/reachability.js';

// Leaflet cannot render vector layers in jsdom – use a stub map.
vi.mock('../src/components/LeafletMap.js', async (orig) => ({ ...(await orig<typeof import('../src/components/LeafletMap.js')>()), LeafletMap: () => null }));

const DISCLAIMER = { version: 1, acceptedAt: '2026-06-01T00:00:00.000Z' };

const memStore = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
};

function fakeWindow(): BridgeWindow {
  const listeners: ((e: MessageEvent) => void)[] = [];
  return {
    parent: { postMessage: () => undefined },
    addEventListener: (_t, cb) => listeners.push(cb),
    removeEventListener: (_t, cb) => listeners.splice(listeners.indexOf(cb), 1),
  };
}

const okReach = async () => ({ state: 'ok' }) as ReachStatus;

async function mount(patch: (c: import('@lockation/core').LockationConfig) => import('@lockation/core').LockationConfig = (c) => c) {
  (globalThis as any).ResizeObserver ??= class { observe() {} disconnect() {} unobserve() {} };
  (globalThis as any).confirm = () => true;
  const { h, render } = await import('preact');
  const { ConfigApp } = await import('../src/config/ConfigApp.js');
  const b = new MockBackend(memStore());
  const { config } = await b.configGet();
  await b.configSave(patch({ ...config, disclaimer: DISCLAIMER }));
  const el = document.createElement('div');
  document.body.appendChild(el);
  vi.useFakeTimers({ shouldAdvanceTime: true });
  render(h(ConfigApp, { backend: b, bridge: new ConfigBridge(fakeWindow()), reachCheck: okReach }), el);
  await vi.advanceTimersByTimeAsync(200);
  const tick = () => vi.advanceTimersByTimeAsync(100);
  const openTab = async (label: string) => {
    const btn = [...el.querySelectorAll('.tabs button')].find((x) => x.textContent?.includes(label)) as HTMLButtonElement | undefined;
    if (!btn) throw new Error(`tab ${label} not found`);
    btn.click();
    await tick();
  };
  const unmount = () => {
    render(null, el);
    el.remove();
  };
  return { el, b, tick, openTab, unmount };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('config page tabs', () => {
  it('renders every tab without crashing', async () => {
    const { el, openTab, unmount } = await mount();
    const expected: [string, RegExp][] = [
      ['Zones', /Zone matching \(default\)/],
      ['Required', /Required zones/],
      ['Forbidden', /Forbidden zones/],
      ['Reward', /Reward zones/],
      ['Travel', /Travel goals/],
      ['Hunt', /Scavenger hunt/],
      ['Tracking', /Check-ins & background tracking/],
      ['Notifications', /Keyholder – notify me about/],
      ['Anti-cheat', /Browser GPS can be faked/],
      ['Privacy', /Zones only – store which zones/],
      ['Import / Export', /Settings file/],
    ];
    for (const [label, text] of expected) {
      await openTab(label);
      expect(el.querySelector('.tabs button.active')?.textContent).toContain(label);
      expect(el.textContent).toMatch(text);
    }
    expect(el.querySelector('[data-testid="settings-file"]')).not.toBeNull();
    unmount();
  });

  it('keeps the exports the tests rely on reachable from ConfigApp', async () => {
    const m = await import('../src/config/ConfigApp.js');
    for (const k of ['ConfigApp', 'travelExample', 'importConfigText', 'checkinMode', 'setCheckinMode', 'SettingsFile', 'ReachNote'] as const) expect(typeof m[k]).toBe('function');
  });
});

describe('hunt "Start at" uses the lock timezone', () => {
  it('stores the UTC instant for a wall time in the lock timezone and shows it back', async () => {
    const { el, b, tick, openTab, unmount } = await mount((c) => ({
      ...c,
      timezone: 'America/New_York',
      rules: { ...c.rules, hunt: { ...c.rules.hunt, enabled: true, start: 'auto', startAt: undefined, startAfterMinutes: undefined } },
    }));
    await openTab('Hunt');
    const start = el.querySelector('[data-testid="hunt-start"]') as HTMLSelectElement;
    start.value = 'scheduled';
    start.dispatchEvent(new Event('change', { bubbles: true }));
    await tick();
    const input = el.querySelector('input[type="datetime-local"]') as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.closest('label')?.textContent).toMatch(/Start at \(lock time zone: America\/New_York\)/);
    expect(input.value).toBe('');
    input.value = '2026-06-01T18:30';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await tick();
    // displayed back as the same wall time in the lock timezone
    expect((el.querySelector('input[type="datetime-local"]') as HTMLInputElement).value).toBe('2026-06-01T18:30');
    // saved as UTC (EDT = UTC−4)
    (([...el.querySelectorAll('button.primary')].find((x) => x.textContent?.includes('Save configuration'))) as HTMLButtonElement).click();
    await tick();
    const saved = (await b.configGet()).config;
    expect(saved.rules.hunt.startAt).toBe('2026-06-01T22:30:00.000Z');
    unmount();
  });

  it('displays a stored instant in the lock timezone, not the browser timezone', async () => {
    const { el, openTab, unmount } = await mount((c) => ({
      ...c,
      timezone: 'Asia/Tokyo',
      rules: { ...c.rules, hunt: { ...c.rules.hunt, enabled: true, start: 'scheduled', startAt: '2026-01-15T03:00:00.000Z', startAfterMinutes: undefined } },
    }));
    await openTab('Hunt');
    expect((el.querySelector('input[type="datetime-local"]') as HTMLInputElement).value).toBe('2026-01-15T12:00');
    unmount();
  });
});

describe('hunt tab: random route', () => {
  it('a random hunt in the demo draws a route and shows its size', async () => {
    const { MockBackend, demoConfig } = await import('../src/lib/mock-backend.js');
    const m = new Map<string, string>();
    const b = new MockBackend({ getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) });
    const cfg = demoConfig();
    const cps = [0, 1, 2].map((i) => ({ ...cfg.rules.hunt.checkpoints[0]!, id: `r${i}`, name: `R${i}`, lat: cfg.rules.hunt.checkpoints[0]!.lat + i * 0.003 }));
    await b.configSave({ ...cfg, disclaimer: { version: 1, acceptedAt: '2026-06-01T00:00:00.000Z' }, rules: { ...cfg.rules, hunt: { ...cfg.rules.hunt, checkpoints: cps, random: { enabled: true, min: 2, max: 3 } } } });
    const v = await b.session();
    expect(v.hunt?.randomRoute).toMatchObject({ drawn: true, min: 2, max: 3, pool: 3 });
    expect([2, 3]).toContain(v.hunt?.total);
  });
});

describe('demo: draw a new random route', () => {
  it('resets the hunt progress and draws a route within the range', async () => {
    const { MockBackend, demoConfig } = await import('../src/lib/mock-backend.js');
    const m = new Map<string, string>();
    const b = new MockBackend({ getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) });
    const cfg = demoConfig();
    const base = cfg.rules.hunt.checkpoints[0]!;
    const cps = [0, 1, 2, 3].map((i) => ({ ...base, id: `r${i}`, name: `R${i}`, lat: base.lat + i * 0.003 }));
    await b.configSave({ ...cfg, disclaimer: { version: 1, acceptedAt: '2026-06-01T00:00:00.000Z' }, rules: { ...cfg.rules, hunt: { ...cfg.rules.hunt, checkpoints: cps, random: { enabled: true, min: 2, max: 3 } } } });
    await b.session();
    for (let i = 0; i < 5; i++) {
      const r = await b.redrawHuntRoute();
      expect(r.drawn).toBe(true);
      expect(r.names.length).toBeGreaterThanOrEqual(2);
      expect(r.names.length).toBeLessThanOrEqual(3);
      expect(new Set(r.names).size).toBe(r.names.length);
      const v = await b.session();
      expect(v.hunt).toMatchObject({ index: 0, status: 'active', total: r.names.length });
    }
    expect(b.demoLog().some((l) => /new random route/.test(l.description))).toBe(true);
  });
});

describe('surprise missions in the demo', () => {
  it('starts a random mission (never a forbidden zone) and the wearer can decline it', async () => {
    const { MockBackend, demoConfig } = await import('../src/lib/mock-backend.js');
    const m = new Map<string, string>();
    const b = new MockBackend({ getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) });
    const cfg = demoConfig();
    await b.configSave({ ...cfg, disclaimer: { version: 1, acceptedAt: '2026-06-01T00:00:00.000Z' }, rules: { ...cfg.rules, mission: { ...cfg.rules.mission, enabled: true, minDistanceM: 0 } } });
    await b.session();
    const v = await b.demoMissionNow();
    const target = cfg.zones.find((z) => z.id === v.mission?.active?.zoneId);
    expect(target).toBeDefined();
    expect(target!.roles).not.toContain('forbidden');
    expect(v.mission?.actions).toContain('decline');
    const d = await b.missionAction({ type: 'decline' });
    expect(d.mission).toMatchObject({ active: undefined, declinesLeft: 0, stats: { declined: 1 } });
  });
});

describe('surprise zones', () => {
  it('role chips: surprise excludes the other roles', async () => {
    const { toggleRole, isValidRoleSet } = await import('../src/config/helpers.js');
    expect(toggleRole(['required', 'reward'], 'surprise')).toEqual(['surprise']);
    expect(toggleRole(['surprise'], 'reward')).toEqual(['reward']);
    expect(toggleRole(['surprise'], 'surprise')).toEqual([]);
    expect(isValidRoleSet(['surprise', 'reward'])).toBe(false);
  });

  it('map marks new, visited, used and holding surprise zones differently', async () => {
    const { surpriseCircle } = await import('../src/main/SurpriseCard.js');
    const z = (status: 'new' | 'visited' | 'used' | 'holding') => surpriseCircle({ id: 'g', name: 'Park', lat: 0, lng: 0, radiusM: 50, kinds: ['surprise'], windows: [], windowActive: false, surprise: { status, visits: status === 'new' ? 0 : 1, once: status === 'used' } });
    expect(z('new')).toMatchObject({ label: '🎁 Park' });
    expect(z('new').dashed).toBeFalsy();
    expect(z('visited')).toMatchObject({ label: '🎁✓ Park', dashed: true });
    expect(z('used')).toMatchObject({ label: '✓ Park', dashed: true });
    expect(z('holding')).toMatchObject({ label: '⏳ Park', selected: true });
    expect(z('used').color).not.toBe(z('new').color);
  });
});

describe('toy actions that keep running (F27)', () => {
  it('the editor offers only the endings that fit the trigger', async () => {
    const { el, openTab, unmount } = await mount();
    await openTab('Forbidden');
    const keeps = [...el.querySelectorAll('select[data-testid="toy-keep"]')] as HTMLSelectElement[];
    const kept = keeps.find((s) => s.value === 'leave'); // the demo casino's wave
    expect(kept).toBeDefined();
    const options = [...kept!.options].map((o) => o.value);
    expect(options).toEqual(['once', 'leave', 'time']);
    expect(el.textContent).toContain('At the latest after (minutes)');
    unmount();
  });
});

describe('toys in the demo (F27)', () => {
  it('connect, test, confirm and emergency stop – nothing is sent unless the wearer switches it on', async () => {
    const { MockBackend } = await import('../src/lib/mock-backend.js');
    const m = new Map<string, string>();
    const b = new MockBackend({ getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) });
    const v0 = await b.session();
    expect(v0.toys).toMatchObject({ connected: false, emergencyStops: 0, onEmergencyStop: 'add 2h' });
    expect(v0.rules.find((r) => r.rule === 'toy')).toBeDefined();
    const toys = [{ id: 'vibe', name: 'Bullet', type: 'vibrator', bodyPart: 'genitals' }];
    await expect(b.toyConnect({ webhookId: 'DEMOHOOK', toys, disclaimerVersion: 1 })).rejects.toThrow(/safety notes/);
    const v1 = await b.toyConnect({ webhookId: 'DEMOHOOK', toys, disclaimerVersion: 2 });
    expect(v1.toys).toMatchObject({ connected: true, verified: false });
    expect(JSON.stringify(v1)).not.toContain('DEMOHOOK');
    const fetchSpy: string[] = [];
    const orig = globalThis.fetch;
    globalThis.fetch = (async (u: string) => {
      fetchSpy.push(String(u));
      return new Response('OK');
    }) as typeof fetch;
    try {
      await b.toyTest();
      expect(fetchSpy).toEqual([]); // demo: not sent by default
      expect((await b.toyConfirm()).toys!.verified).toBe(true);
      b.toyReal = true;
      await b.toyTest();
      expect(fetchSpy[0]).toContain('https://webhook.xtoys.app/DEMOHOOK?action=lockation');
      const v2 = await b.toyEmergencyStop();
      expect(v2.toys).toMatchObject({ connected: false, emergencyStops: 1 });
      expect(fetchSpy.at(-1)).toContain('cmd=stopAll');
      expect(b.demoLog().some((l) => /Emergency stop/.test(l.description))).toBe(true);
    } finally {
      globalThis.fetch = orig;
    }
  });
});
