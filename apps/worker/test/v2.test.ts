import { beforeEach, describe, expect, it } from 'vitest';
import { handleRequest, runCron, type Overrides } from '../src/index.js';
import { FakeChaster, FakeD1, FakeNtfy, makeEnv } from './fake-chaster.js';

const HOME = { lat: 47.3769, lng: 8.5417 };
const BAR = { lat: 47.39, lng: 8.515 };
const ACC = { version: 1, acceptedAt: '2026-06-01T00:00:00.000Z' };

const config = {
  version: 2,
  timezone: 'Europe/Zurich',
  zones: [
    { id: 'home', name: 'Home', ...HOME, radiusM: 100, roles: ['required'] },
    { id: 'bar', name: 'Bar', ...BAR, radiusM: 100, roles: ['forbidden'] },
  ],
  tracking: { enabled: true, heartbeatMinutes: 120, onHeartbeatMissed: [{ type: 'add_time', seconds: 1800 }] },
  rules: {
    required: { enabled: true, intervalMinutes: 480 },
    forbidden: { enabled: true, onEnter: [{ type: 'add_time', seconds: 3600 }] },
    hunt: { enabled: true, reveal: 'all', checkpoints: [{ id: 'c1', name: 'Fountain', lat: 47.4, lng: 8.6, radiusM: 60, hint: 'x' }] },
  },
};

let fake: FakeChaster;
let db: FakeD1;
let ntfy: FakeNtfy;
let env: ReturnType<typeof makeEnv>;
let now: Date;
let ids = 0;
const o = (): Overrides => ({ fetch: fake.fetch, ntfyFetch: ntfy.fetch, now: () => now, rng: () => 0.99, newId: () => `id${++ids}` });
const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  handleRequest(new Request(`https://worker.test${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://user.github.io', ...headers }, body: JSON.stringify(body) }), env, o());
const basic = (u: string, p: string) => ({ Authorization: `Basic ${btoa(`${u}:${p}`)}` });
const loc = (p: { lat: number; lng: number }, at: Date) => ({ _type: 'location', lat: p.lat, lon: p.lng, acc: 10, tst: Math.floor(at.getTime() / 1000) });
const at = (m: number) => new Date(Date.parse('2026-06-01T10:30:00.000Z') + m * 60_000);

async function pair() {
  const r = await post('/api/tracking/pair', { mainToken: 'wearer-token' });
  expect(r.status).toBe(200);
  return (await r.json()) as { link: string; username: string; password: string };
}
async function subscribe(token: string) {
  const r = await post('/api/notify/setup', { mainToken: token });
  expect(r.status).toBe(200);
  return (await r.json()) as { topic: string; url: string; deepLink: string; view: any };
}

beforeEach(() => {
  fake = new FakeChaster();
  db = new FakeD1();
  ntfy = new FakeNtfy();
  env = makeEnv(db, { NTFY_TOKEN: 'ntfy-token' });
  now = at(0);
  ids = 0;
  fake.addSession('s1', config);
  fake.mainTokens.set('wearer-token', { role: 'wearer', sessionId: 's1' });
  fake.mainTokens.set('kh-token', { role: 'keyholder', sessionId: 's1' });
});

describe('notifications (ntfy)', () => {
  it('setup returns topic links; disabled without token', async () => {
    const s = await subscribe('wearer-token');
    expect(s.topic).toMatch(/^lockation-[A-Za-z0-9]{32}$/);
    expect(s.url).toBe(`https://ntfy.sh/${s.topic}`);
    expect(s.deepLink).toBe(`ntfy://ntfy.sh/${s.topic}`);
    expect(s.view.notifications).toEqual({ available: true, subscribed: true });
    expect(ntfy.sent[0]).toMatchObject({ topic: s.topic, title: 'Lockation' });
    const stop = (await (await post('/api/notify/stop', { mainToken: 'wearer-token' })).json()) as any;
    expect(stop.notifications.subscribed).toBe(false);

    env = makeEnv(db);
    const off = await post('/api/notify/setup', { mainToken: 'wearer-token' });
    expect(off.status).toBe(503);
  });

  it('forbidden zone: wearer warning at 2′ and keyholder notice via the 1-minute cron, penalty at 10′', async () => {
    const p = await pair();
    const w = await subscribe('wearer-token');
    const k = await subscribe('kh-token');
    ntfy.sent = [];
    await post('/track/owntracks', loc(BAR, now), basic(p.username, p.password));
    expect(db.rows('due')).toHaveLength(1);
    expect(db.rows('due')[0]!.next_at).toBe(at(2).getTime());

    now = at(2);
    const r = await runCron(env, o(), 40, { full: false });
    expect(r).toMatchObject({ mode: 'due', processed: 1 });
    expect(ntfy.sent.map((m) => [m.topic, m.title])).toEqual([
      [w.topic, 'Forbidden zone "Bar"'],
      [k.topic, 'Lockation: forbidden zone'],
    ]);
    expect(ntfy.sent[0]!.priority).toBe(4);
    // the warning is also in the lock history
    expect(fake.calls.filter((c) => c.path.endsWith('/logs/custom')).map((c) => c.body.description).join('\n')).toMatch(/Warning: inside forbidden zone "Bar"/);

    await post('/track/owntracks', loc(BAR, at(9)), basic(p.username, p.password));
    now = at(10);
    ntfy.sent = [];
    await runCron(env, o(), 40, { full: false });
    expect(fake.actionCalls().map((c) => c.body.action)).toEqual([{ name: 'add_time', params: 3600 }]);
    expect(ntfy.sent.map((m) => m.title)).toEqual(['Lockation: penalty applied']);
    // same minute again → nothing twice
    await runCron(env, o(), 40, { full: false });
    expect(fake.actionCalls()).toHaveLength(1);
  });

  it('keyholder switches and self-locks suppress keyholder notices', async () => {
    fake.addSession('s1', { ...config, notifications: { keyholder: { forbiddenEntered: false } } });
    const p = await pair();
    await subscribe('kh-token');
    ntfy.sent = [];
    await post('/track/owntracks', loc(BAR, now), basic(p.username, p.password));
    now = at(2);
    await runCron(env, o(), 40, { full: false });
    expect(ntfy.sent).toHaveLength(0);
  });

  it('1-minute cron only touches due sessions; the 5th minute sweeps all', async () => {
    fake.addSession('s2', config);
    now = at(1);
    await runCron(env, o(), 40, { full: false });
    expect(fake.calls).toHaveLength(0);
    const full = await runCron(env, o(), 40, { full: true });
    expect(full).toMatchObject({ mode: 'full', processed: 2, done: true });
    expect(db.rows('due').length).toBe(2);
  });
});

describe('configuration changes during a running lock', () => {
  it('writes a history entry, notifies the wearer and shows "rules changed" until acknowledged', async () => {
    const w = await subscribe('wearer-token');
    ntfy.sent = [];
    fake.configTokens.set('cfg', { config, role: 'keyholder', sessionId: 's1' });
    const changed = { ...config, zones: [...config.zones, { id: 'casino', name: 'Casino', lat: 47.41, lng: 8.52, radiusM: 100, roles: ['forbidden'] }], disclaimer: ACC };
    const r = await post('/api/config/save', { configToken: 'cfg', config: changed });
    expect(r.status).toBe(200);
    const log = fake.calls.find((c) => c.path.endsWith('/logs/custom') && c.body.title === 'Lockation rules changed');
    expect(log?.body.description).toContain('Zone "Casino" added (forbidden, 100 m).');
    expect(ntfy.sent.map((m) => [m.topic, m.title])).toEqual([[w.topic, 'Lockation rules changed']]);
    const v = (await (await post('/api/session', { mainToken: 'wearer-token' })).json()) as any;
    expect(v.rulesChanged.summary).toContain('Zone "Casino" added (forbidden, 100 m).');
    expect((await post('/api/notice/ack', { mainToken: 'kh-token' })).status).toBe(403);
    const acked = (await (await post('/api/notice/ack', { mainToken: 'wearer-token' })).json()) as any;
    expect(acked.rulesChanged).toBeUndefined();
  });

  it('no notice when nothing relevant changed', async () => {
    fake.configTokens.set('cfg', { config, role: 'keyholder', sessionId: 's1' });
    await post('/api/config/save', { configToken: 'cfg', config: { ...config, disclaimer: ACC } });
    expect(fake.calls.some((c) => c.body?.title === 'Lockation rules changed')).toBe(false);
  });
});

describe('OwnTracks v2', () => {
  it('provisions the effective mode and pushes zones plus visible checkpoints', async () => {
    const p = await pair();
    const otrc = JSON.parse(atob(decodeURIComponent(p.link.split('inline=')[1]!)));
    expect(otrc.monitoring).toBe(2); // heartbeat 120 ≥ 60 but forbidden zones exist → move
    const first = (await (await post('/track/owntracks', loc(HOME, now), basic(p.username, p.password))).json()) as any[];
    expect(first[0].waypoints.waypoints.map((w: any) => w.desc)).toEqual(['Home', 'Bar', 'Hunt 1: Fountain']);
    expect(first).toHaveLength(1); // mode already matches the provisioned one
  });

  it('sends setConfiguration when the effective mode changes', async () => {
    const p = await pair();
    await post('/track/owntracks', loc(HOME, now), basic(p.username, p.password));
    const sess = fake.sessions.get('s1')!;
    sess.config = { ...config, tracking: { ...config.tracking, owntracksMode: 'significant' } };
    now = at(1);
    const res = (await (await post('/track/owntracks', loc(HOME, now), basic(p.username, p.password))).json()) as any[];
    expect(res).toContainEqual({ _type: 'cmd', action: 'setConfiguration', configuration: { _type: 'configuration', monitoring: 1 } });
  });
});

describe('session end', () => {
  it('delete webhook purges history, devices, topics and due entries', async () => {
    const p = await pair();
    await subscribe('wearer-token');
    await post('/track/owntracks', loc(BAR, now), basic(p.username, p.password));
    const auth = { Authorization: `Basic ${btoa('hook:secret')}` };
    await post('/webhook', { event: 'extension_session.deleted', data: { session: { sessionId: 's1' } } }, auth);
    for (const t of ['history', 'devices', 'topics', 'due', 'sent']) expect(db.rows(t).filter((r) => r.session_id === 's1')).toHaveLength(0);
  });
});
