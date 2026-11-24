import { beforeEach, describe, expect, it } from 'vitest';
import { handleRequest, runCron, type Overrides } from '../src/index.js';
import { FakeChaster, FakeD1, historyOf, makeEnv } from './fake-chaster.js';

const HOME = { lat: 47.3769, lng: 8.5417 };
const BAR = { lat: 47.39, lng: 8.515 };

const config = {
  timezone: 'Europe/Zurich',
  zones: [
    { id: 'home', name: 'Home', ...HOME, radiusM: 100 },
    { id: 'bar', name: 'Bar', ...BAR, radiusM: 100 },
  ],
  tracking: { enabled: true, heartbeatMinutes: 120, entryConfirmMinutes: 0, onHeartbeatMissed: [{ type: 'add_time', seconds: 1800 }] },
  rules: {
    forbidden: { enabled: true, zoneIds: ['bar'], onEnter: [{ type: 'add_time', seconds: 3600 }] },
    hunt: { enabled: true, checkpoints: [{ id: 'c1', name: 'SecretSpot', lat: 47.4, lng: 8.6, radiusM: 80, hint: 'x' }] },
  },
};

let fake: FakeChaster;
let db: FakeD1;
let env: ReturnType<typeof makeEnv>;
let now: Date;
let ids = 0;
const o = (): Overrides => ({ fetch: fake.fetch, now: () => now, rng: () => 0.99, newId: () => `id${++ids}` });

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  handleRequest(
    new Request(`https://worker.test${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://user.github.io', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) }),
    env,
    o(),
  );

const basic = (u: string, p: string) => ({ Authorization: `Basic ${btoa(`${u}:${p}`)}` });
const loc = (p: { lat: number; lng: number }, at: Date, acc = 10) => ({ _type: 'location', lat: p.lat, lon: p.lng, acc, tst: Math.floor(at.getTime() / 1000), tid: 'LO' });

async function pair() {
  const r = await post('/api/tracking/pair', { mainToken: 'wearer-token' });
  expect(r.status).toBe(200);
  return (await r.json()) as { link: string; url: string; username: string; password: string; view: any };
}

beforeEach(() => {
  fake = new FakeChaster();
  db = new FakeD1();
  env = makeEnv(db);
  now = new Date('2026-06-01T10:30:00.000Z');
  fake.addSession('s1', config);
  fake.mainTokens.set('wearer-token', { role: 'wearer', sessionId: 's1' });
  fake.mainTokens.set('kh-token', { role: 'keyholder', sessionId: 's1' });
});

describe('F14 pairing', () => {
  it('AC1 returns a provisioning link; only the wearer can pair', async () => {
    expect((await post('/api/tracking/pair', { mainToken: 'kh-token' })).status).toBe(403);
    const p = await pair();
    expect(p.url).toBe('https://worker.test/track/owntracks');
    const cfg = JSON.parse(atob(decodeURIComponent(p.link.split('inline=')[1]!)));
    expect(cfg).toMatchObject({ mode: 3, url: p.url, username: p.username, password: p.password, cmd: true });
    expect(p.view.tracking.paired).toBe(true);
    const stored = db.rows('devices').find((r) => r.username === p.username)!;
    expect(stored.session_id).toBe('s1');
    expect(JSON.stringify(stored)).not.toContain(p.password);
  });

  it('AC1 re-pairing revokes the old credentials', async () => {
    const a = await pair();
    const b = await pair();
    expect((await post('/track/owntracks', loc(HOME, now), basic(a.username, a.password))).status).toBe(401);
    expect((await post('/track/owntracks', loc(HOME, now), basic(b.username, b.password))).status).toBe(200);
  });

  it('pairing needs tracking enabled', async () => {
    fake.sessions.get('s1')!.config = { ...config, tracking: { enabled: false } };
    expect((await post('/api/tracking/pair', { mainToken: 'wearer-token' })).status).toBe(409);
  });
});

describe('F14 ingest', () => {
  it('AC2 wrong credentials → 401', async () => {
    const p = await pair();
    expect((await post('/track/owntracks', loc(HOME, now), basic(p.username, 'wrong'))).status).toBe(401);
    expect((await post('/track/owntracks', loc(HOME, now))).status).toBe(401);
  });

  it('AC9 first message gets waypoints (zones only), later ones do not', async () => {
    const p = await pair();
    const r1: any[] = await (await post('/track/owntracks', loc(HOME, now), basic(p.username, p.password))).json();
    expect(r1).toHaveLength(1);
    expect(r1[0]).toMatchObject({ _type: 'cmd', action: 'setWaypoints' });
    expect(JSON.stringify(r1)).not.toContain('SecretSpot');
    now = new Date(now.getTime() + 60_000);
    const r2: any[] = await (await post('/track/owntracks', loc(HOME, now), basic(p.username, p.password))).json();
    expect(r2).toEqual([]);
    // zones change → pushed again
    fake.sessions.get('s1')!.config = { ...config, zones: [{ ...config.zones[0], radiusM: 200 }, config.zones[1]] };
    now = new Date(now.getTime() + 60_000);
    const r3: any[] = await (await post('/track/owntracks', loc(HOME, now), basic(p.username, p.password))).json();
    expect(r3).toHaveLength(1);
  });

  it('forbidden zone via background location applies consequences, logs and records history', async () => {
    const p = await pair();
    await post('/track/owntracks', loc(HOME, now), basic(p.username, p.password));
    now = new Date(now.getTime() + 20 * 60_000);
    const r = await post('/track/owntracks', loc(BAR, now), basic(p.username, p.password));
    expect(r.status).toBe(200);
    expect(fake.actionCalls().map((c) => c.body.action)).toEqual([{ name: 'add_time', params: 3600 }]);
    const logs = fake.calls.filter((c) => c.path.endsWith('/logs/custom')).map((c) => c.body.title);
    expect(logs).toContain('GPS background update: Bar');
    const history = historyOf(db, 's1');
    expect(history[0].source).toBe('tracked');
    expect(history[0].lat).toBeUndefined(); // zone_only privacy by default
  });

  it('ignores unknown message types and empty bodies', async () => {
    const p = await pair();
    expect((await post('/track/owntracks', { _type: 'lwt', tst: 1 }, basic(p.username, p.password))).status).toBe(200);
    expect((await post('/track/owntracks', '', basic(p.username, p.password))).status).toBe(200);
    expect(fake.actionCalls()).toHaveLength(0);
  });

  it('unpair revokes the device; heartbeat penalty follows via cron', async () => {
    const p = await pair();
    await post('/track/owntracks', loc(HOME, now), basic(p.username, p.password));
    const v: any = await (await post('/api/tracking/unpair', { mainToken: 'wearer-token' })).json();
    expect(v.tracking.paired).toBe(false);
    expect((await post('/track/owntracks', loc(HOME, now), basic(p.username, p.password))).status).toBe(401);
    now = new Date(now.getTime() + 125 * 60_000);
    fake.calls = [];
    await runCron(env, o());
    expect(fake.actionCalls().map((c) => c.body.action)).toEqual([{ name: 'add_time', params: 1800 }]);
  });

  it('AC10 delete webhook removes device credentials', async () => {
    const p = await pair();
    const r = await post('/webhook', { event: 'extension_session.deleted', data: { session: { sessionId: 's1' } } }, basic('hook', 'secret'));
    expect(r.status).toBe(204);
    expect(db.rows('devices').some((r) => r.username === p.username)).toBe(false);
  });
});

describe('F16 live tracking only', () => {
  it('rejects manual check-ins with 403 and records nothing; tracking still works', async () => {
    fake.addSession('s2', { ...config, tracking: { ...config.tracking, liveOnly: true } });
    fake.mainTokens.set('live-token', { role: 'wearer', sessionId: 's2' });
    const fix = { lat: BAR.lat, lng: BAR.lng, accuracy: 10, timestamp: now.getTime() };
    const r = await post('/api/checkin', { mainToken: 'live-token', fix, purpose: 'general' });
    expect(r.status).toBe(403);
    expect(((await r.json()) as any).error.code).toBe('manual_disabled');
    expect(fake.actionCalls().length).toBe(0);
    const view = (await (await post('/api/session', { mainToken: 'live-token' })).json()) as any;
    expect(view.liveOnly).toBe(true);
    expect(view.history).toEqual([]);

    const p = (await (await post('/api/tracking/pair', { mainToken: 'live-token' })).json()) as any;
    const t = await post('/track/owntracks', loc(BAR, now), basic(p.username, p.password));
    expect(t.status).toBe(200);
    expect(fake.actionCalls().map((c) => c.body.action)).toEqual([{ name: "add_time", params: 3600 }]);
  });
});

describe('security: only wearer and keyholder', () => {
  it('refuses any other role with 403 and returns no zones or locations', async () => {
    fake.mainTokens.set('other-token', { role: 'viewer' as any, sessionId: 's1' });
    const r = await post('/api/session', { mainToken: 'other-token' });
    expect(r.status).toBe(403);
    const body = (await r.json()) as any;
    expect(body.error.code).toBe('not_allowed');
    expect(JSON.stringify(body)).not.toMatch(/zones|lat|lng/);
  });

  it('reports "waiting" after pairing and "connected" after the first location', async () => {
    const p = await pair();
    expect(p.view.tracking.status).toBe('waiting');
    await post('/track/owntracks', loc(HOME, now), basic(p.username, p.password));
    let v = (await (await post('/api/session', { mainToken: 'wearer-token' })).json()) as any;
    expect(v.tracking).toMatchObject({ status: 'waiting', receiving: true }); // automatic location: setup not confirmed yet
    await post('/track/owntracks', { ...loc(HOME, now), t: 'u' }, basic(p.username, p.password));
    v = (await (await post('/api/session', { mainToken: 'wearer-token' })).json()) as any;
    expect(v.tracking.status).toBe('connected');
  });
});

describe('security: configuration page roles', () => {
  it('refuses config endpoints for other roles', async () => {
    fake.configTokens.set('cfg-other', { config: {}, role: 'viewer' as any, sessionId: 's1' });
    for (const path of ['/api/config/get', '/api/capabilities']) {
      const r = await post(path, { configToken: 'cfg-other' });
      expect(r.status).toBe(403);
    }
    const save = await post('/api/config/save', { configToken: 'cfg-other', config: { disclaimer: { version: 1, acceptedAt: 'x' } } });
    expect(save.status).toBe(403);
  });
});
