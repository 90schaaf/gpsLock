import { beforeEach, describe, expect, it } from 'vitest';
import { handleRequest, runCron, type Overrides } from '../src/index.js';
import { FakeChaster, FakeD1, historyOf, makeEnv } from './fake-chaster.js';

const HOME = { lat: 47.3769, lng: 8.5417 };
const BAR = { lat: 47.39, lng: 8.515 };
const NOW = new Date('2026-06-01T12:00:00.000Z');

const config = {
  timezone: 'Europe/Zurich',
  zones: [
    { id: 'home', name: 'Home', ...HOME, radiusM: 100 },
    { id: 'bar', name: 'Bar', ...BAR, radiusM: 100 },
  ],
  rules: {
    required: { enabled: true, zoneIds: ['home'], intervalMinutes: 240, graceMinutes: 0, onMissed: [{ type: 'add_time', seconds: 3600 }] },
    forbidden: {
      enabled: true,
      zoneIds: ['bar'],
      onEnter: [
        { type: 'pillory', durationMinutes: 30, reason: 'Bar!' },
        { type: 'task', task: 'Write an apology', points: 0 },
        { type: 'command', commandId: 'penalty.increment', input: { habit: 'bar' } },
        { type: 'freeze', durationMinutes: 60 },
      ],
    },
  },
  privacy: { coordinates: 'exact' },
};

let fake: FakeChaster;
let db: FakeD1;
let env: ReturnType<typeof makeEnv>;
let now: Date;
let ids = 0;
const o = (): Overrides => ({ fetch: fake.fetch, now: () => now, rng: () => 0.99, newId: () => `id${++ids}` });

function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return handleRequest(
    new Request(`https://worker.test${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://user.github.io', ...headers }, body: JSON.stringify(body) }),
    env,
    o(),
  );
}

const fix = (p: { lat: number; lng: number }, accuracy = 10) => ({ ...p, accuracy, timestamp: now.getTime() - 1000 });

beforeEach(() => {
  fake = new FakeChaster();
  db = new FakeD1();
  env = makeEnv(db);
  now = NOW;
  fake.addSession('s1', config);
  fake.mainTokens.set('wearer-token', { role: 'wearer', sessionId: 's1' });
  fake.mainTokens.set('kh-token', { role: 'keyholder', sessionId: 's1' });
});

describe('HTTP basics', () => {
  it('health + CORS', async () => {
    const r = await handleRequest(new Request('https://w/health', { headers: { Origin: 'https://user.github.io' } }), env, o());
    expect(r.status).toBe(200);
    expect(r.headers.get('Access-Control-Allow-Origin')).toBe('https://user.github.io');
    const bad = await handleRequest(new Request('https://w/health', { headers: { Origin: 'https://evil.example' } }), env, o());
    expect(bad.headers.get('Access-Control-Allow-Origin')).toBeNull();
    const pre = await handleRequest(new Request('https://w/api/checkin', { method: 'OPTIONS', headers: { Origin: 'https://user.github.io' } }), env, o());
    expect(pre.status).toBe(204);
  });

  it('validates bodies and unknown tokens', async () => {
    expect((await post('/api/checkin', { mainToken: 'wearer-token', fix: { lat: 200 } })).status).toBe(400);
    expect((await post('/api/session', { mainToken: 'nope' })).status).toBe(404);
    expect((await post('/api/unknown', {})).status).toBe(404);
  });
});

describe('F10 session + check-in flow', () => {
  it('returns a role specific view', async () => {
    const r = await post('/api/session', { mainToken: 'kh-token' });
    const v: any = await r.json();
    expect(v.role).toBe('keyholder');
    expect(v.zones).toHaveLength(2);
    expect(v.required.nextDeadline).toBe('2026-06-01T14:00:00.000Z');
  });

  it('keyholder cannot check in', async () => {
    expect((await post('/api/checkin', { mainToken: 'kh-token', fix: fix(HOME) })).status).toBe(403);
  });

  it('valid check-in persists state, metadata, log and history', async () => {
    const r = await post('/api/checkin', { mainToken: 'wearer-token', fix: fix(HOME) });
    expect(r.status).toBe(200);
    const body: any = await r.json();
    expect(body.record.outcome).toBe('accepted');
    expect(body.record.zones).toEqual(['Home']);
    const s = fake.sessions.get('s1')!;
    expect(Object.values((s.data as any).lockation.required.slots as Record<string, any>)[0].nextDeadline).toBe('2026-06-01T16:00:00.000Z');
    expect((s as any).metadata.homeActions[0].slug).toBe('checkin');
    expect(fake.calls.some((c) => c.path.endsWith('/logs/custom'))).toBe(true);
    expect(body.view.history).toHaveLength(1);
    expect(body.view.history[0].lat).toBe(HOME.lat);
  });

  it('F7 forbidden zone triggers all consequence types with correct requests; failures are isolated', async () => {
    fake.failActions.add('pillory');
    const r = await post('/api/checkin', { mainToken: 'wearer-token', fix: fix(BAR) });
    const body: any = await r.json();
    const calls = fake.actionCalls();
    expect(calls.map((c) => [c.path.replace('/api/extensions/sessions/s1', ''), c.body])).toEqual([
      ['/action', { action: { name: 'pillory', params: { duration: 1800, reason: 'Bar!' } } }],
      ['/tasks/assign', { task: { task: 'Write an apology', points: 0, verificationRequired: false }, actor: 'extension' }],
      ['/actions/penalty.increment', { actor: 'extension', input: { habit: 'bar' }, idempotencyKey: expect.stringContaining('s1:forbidden:bar:') }],
      ['/action', { action: { name: 'freeze' } }],
    ]);
    expect(body.record.consequences.map((c: any) => c.ok)).toEqual([false, true, true, true]);
    expect(body.record.consequences[0].error).toMatch(/pillory failed/);
  });

  it('rejected check-in (poor accuracy) applies nothing', async () => {
    const body: any = await (await post('/api/checkin', { mainToken: 'wearer-token', fix: fix(BAR, 400) })).json();
    expect(body.record.reason).toBe('poor_accuracy');
    expect(fake.actionCalls()).toHaveLength(0);
  });

  it('not locked → 409', async () => {
    fake.sessions.get('s1')!.lock.status = 'unlocked';
    expect((await post('/api/checkin', { mainToken: 'wearer-token', fix: fix(HOME) })).status).toBe(409);
  });
});

describe('F9 privacy', () => {
  it('downgrade redacts history', async () => {
    await post('/api/checkin', { mainToken: 'wearer-token', fix: fix(HOME) });
    const v: any = await (await post('/api/privacy', { mainToken: 'wearer-token', coordinates: 'zone_only' })).json();
    expect(v.privacy).toBe('zone_only');
    expect(v.privacyLocked).toBe(true);
    const stored = historyOf(db, 's1');
    expect(stored[0].lat).toBeUndefined();
  });

  it('upgrade during a running session is refused', async () => {
    fake.configTokens.set('cfg', { config: { ...config, privacy: { coordinates: 'zone_only' } }, role: 'keyholder', sessionId: 's1' });
    const r = await post('/api/config/save', { configToken: 'cfg', config: { ...config, privacy: { coordinates: 'exact' }, disclaimer: { version: 1, acceptedAt: '2026-06-01T00:00:00.000Z' } } });
    expect(r.status).toBe(403);
  });

  it('delete webhook purges history', async () => {
    await post('/api/checkin', { mainToken: 'wearer-token', fix: fix(HOME) });
    const auth = { Authorization: `Basic ${btoa('hook:secret')}` };
    const r = await post('/webhook', { event: 'extension_session.deleted', data: { session: { sessionId: 's1' } } }, auth);
    expect(r.status).toBe(204);
    expect(historyOf(db, 's1').length > 0).toBe(false);
  });
});

describe('F11 configuration endpoints', () => {
  beforeEach(() => fake.configTokens.set('cfg', { config: {}, role: 'keyholder', sessionId: null }));

  it('get returns defaults for an empty config', async () => {
    const v: any = await (await post('/api/config/get', { configToken: 'cfg' })).json();
    expect(v.config.version).toBe(2);
    expect(v.role).toBe('keyholder');
  });

  it('save validates and stores normalized config', async () => {
    const bad = await post('/api/config/save', { configToken: 'cfg', config: { zones: [{ id: 'x', name: 'X', lat: 0, lng: 0, radiusM: 5 }] } });
    expect(bad.status).toBe(400);
    const err: any = await bad.json();
    expect(err.error.details[0].path).toBe('zones.0.radiusM');
    const noDisclaimer = await post('/api/config/save', { configToken: 'cfg', config });
    expect(noDisclaimer.status).toBe(400);
    expect(((await noDisclaimer.json()) as any).error.code).toBe('disclaimer_required');
    const ok = await post('/api/config/save', { configToken: 'cfg', config: { ...config, disclaimer: { version: 1, acceptedAt: '2026-06-01T00:00:00.000Z' } } });
    expect(ok.status).toBe(200);
    expect((fake.configTokens.get('cfg')!.config as any).antiCheat.maxAccuracyM).toBe(100);
    expect((fake.configTokens.get('cfg')!.config as any).disclaimer.version).toBe(1);
  });

  it('stored configs without disclaimer stay readable', async () => {
    const v: any = await (await post('/api/config/get', { configToken: 'cfg' })).json();
    expect(v.invalidStoredConfig).toBeUndefined();
    expect(v.config.disclaimer).toBeUndefined();
  });

  it('capabilities: known list without session, live list with session', async () => {
    const known: any = await (await post('/api/capabilities', { configToken: 'cfg' })).json();
    expect(known.live).toBe(false);
    expect(known.commands.map((c: any) => c.id)).toContain('tasks.assign');
    fake.capabilities = [{ slug: 'tasks', displayName: 'Tasks', commands: [{ id: 'tasks.assign', title: 'Assign', description: '', available: true, invocableBy: ['extension'], inputSchema: {} }] }];
    const live: any = await (await post('/api/capabilities', { mainToken: 'wearer-token' })).json();
    expect(live.live).toBe(true);
    expect(live.commands).toHaveLength(1);
  });
});

describe('webhooks', () => {
  it('rejects bad credentials', async () => {
    expect((await post('/webhook', { event: 'x' }, { Authorization: `Basic ${btoa('hook:wrong')}` })).status).toBe(401);
    expect((await post('/webhook', { event: 'x' })).status).toBe(401);
  });
  it('created initialises state and metadata', async () => {
    const s = fake.addSession('s2', config);
    await post('/webhook', { payload: { event: 'extension_session.created', data: { session: s } } }, { Authorization: `Basic ${btoa('hook:secret')}` });
    expect((fake.sessions.get('s2')!.data as any).lockation.v).toBe(2);
    expect((fake.sessions.get('s2') as any).metadata).toBeDefined();
  });
});

describe('F2 cron', () => {
  it('applies missed penalty once and paginates with a budget', async () => {
    for (let i = 2; i <= 20; i++) fake.addSession(`s${i}`, { ...config, privacy: undefined });
    now = new Date('2026-06-01T14:05:00.000Z'); // deadline 14:00, grace 0
    const all: { processed: number; done: boolean }[] = [];
    for (let i = 0; i < 20 && !all.at(-1)?.done; i++) all.push(await runCron(env, o(), 40));
    expect(all.reduce((a, r) => a + r.processed, 0)).toBe(20);
    const addTime = fake.actionCalls().filter((c) => c.body?.action?.name === 'add_time');
    expect(addTime).toHaveLength(20);
    // running again does nothing
    fake.calls = [];
    const again = await runCron(env, o(), 40);
    expect(fake.actionCalls()).toHaveLength(0);
    expect(again.done).toBe(true);
  });
});
