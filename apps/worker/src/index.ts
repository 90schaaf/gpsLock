/** Cloudflare Worker entry: HTTP API, Chaster webhooks and cron. */
import { z } from 'zod';
import { ChasterClient, sessionIdOf, type ChasterSession, type FetchLike } from './chaster.js';
import { Ntfy } from './notify.js';
import { LockationService } from './service.js';
import { parseBasicAuth, safeEqual, Store } from './store.js';
import { HttpError, type Env, type ExecutionContextLike } from './types.js';

export const VERSION = '0.1.0';

const FixSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy: z.number().min(0).max(100_000),
  timestamp: z.number().int().positive(),
});

const bodies = {
  session: z.object({ mainToken: z.string().min(1) }),
  checkin: z.object({ mainToken: z.string().min(1), fix: FixSchema, purpose: z.enum(['general', 'hunt']).default('general') }),
  privacy: z.object({ mainToken: z.string().min(1), coordinates: z.literal('zone_only') }),
  configGet: z.object({ configToken: z.string().min(1) }),
  configSave: z.object({ configToken: z.string().min(1), config: z.unknown() }),
  capabilities: z.object({ mainToken: z.string().optional(), configToken: z.string().optional() }),
  tracking: z.object({ mainToken: z.string().min(1) }),
  hunt: z.object({ mainToken: z.string().min(1), action: z.enum(['start', 'pause', 'resume', 'abort']) }),
  mission: z.object({
    mainToken: z.string().min(1),
    action: z.discriminatedUnion('type', [
      z.object({ type: z.literal('send'), zoneId: z.string().min(1).max(100), minutes: z.number().int().min(5).max(720).optional() }),
      z.object({ type: z.literal('decline') }),
      z.object({ type: z.literal('cancel') }),
    ]),
  }),
};

export interface Overrides {
  fetch?: FetchLike;
  /** Separate fetch for ntfy (tests). Defaults to `fetch`. */
  ntfyFetch?: FetchLike;
  now?: () => Date;
  rng?: () => number;
  newId?: () => string;
}

export function createService(env: Env, o: Overrides = {}) {
  const client = new ChasterClient(env.CHASTER_TOKEN, env.CHASTER_API_BASE ?? 'https://api.chaster.app', o.fetch);
  const store = new Store(env.DB);
  const ntfy = Ntfy.from(env, o.ntfyFetch ?? o.fetch ?? ((i, init) => fetch(i, init)));
  const service = new LockationService({ client, store, ntfy, appUrl: env.APP_URL, now: o.now, rng: o.rng, newId: o.newId });
  return { client, store, service };
}

function corsHeaders(env: Env, origin: string | null): Record<string, string> {
  const allowed = (env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const ok = origin && (allowed.includes(origin) || allowed.includes('*'));
  return ok
    ? { 'Access-Control-Allow-Origin': origin!, 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400', Vary: 'Origin' }
    : { Vary: 'Origin' };
}

const json = (data: unknown, status: number, headers: Record<string, string>) =>
  new Response(data === null ? null : JSON.stringify(data), { status, headers: { ...(data === null ? {} : { 'Content-Type': 'application/json' }), ...headers } });

async function parseBody<T extends z.ZodTypeAny>(req: Request, schema: T): Promise<z.infer<T>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new HttpError(400, 'invalid_json', 'Request body must be JSON.');
  }
  const r = schema.safeParse(raw);
  if (!r.success) throw new HttpError(400, 'invalid_request', 'Invalid request body.', r.error.issues);
  return r.data;
}

function checkBasicAuth(env: Env, req: Request): boolean {
  if (!env.WEBHOOK_USERNAME || !env.WEBHOOK_PASSWORD) return false;
  const h = req.headers.get('Authorization') ?? '';
  if (!h.startsWith('Basic ')) return false;
  let decoded = '';
  try {
    decoded = atob(h.slice(6));
  } catch {
    return false;
  }
  return safeEqual(decoded, `${env.WEBHOOK_USERNAME}:${env.WEBHOOK_PASSWORD}`);
}

export async function handleWebhook(service: LockationService, body: unknown): Promise<void> {
  const evt = (body && typeof body === 'object' && 'payload' in body ? (body as { payload: unknown }).payload : body) as {
    event?: string;
    data?: { session?: ChasterSession & { sessionId?: string } };
  };
  const session = evt?.data?.session;
  switch (evt?.event) {
    case 'extension_session.created':
      if (session) await service.initSession(session);
      return;
    case 'extension_session.updated':
      if (session && session.lock?.status !== 'unlocked') await service.tickSession(session);
      return;
    case 'extension_session.deleted':
      if (session) await service.onSessionDeleted(sessionIdOf(session));
      return;
    default:
      return; // action.invoke, lock_event.created … are not used yet
  }
}

export async function handleRequest(req: Request, env: Env, o: Overrides = {}): Promise<Response> {
  const url = new URL(req.url);
  const cors = corsHeaders(env, req.headers.get('Origin'));
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  const { service } = createService(env, o);
  try {
    if (req.method === 'GET' && url.pathname === '/health') return json({ ok: true, version: VERSION, commit: env.GIT_SHA ?? 'unknown', deployedAt: env.DEPLOYED_AT }, 200, cors);
    if (req.method !== 'POST') throw new HttpError(405, 'method_not_allowed', 'Use POST.');

    switch (url.pathname) {
      case '/api/session': {
        const b = await parseBody(req, bodies.session);
        return json(await service.sessionView(b.mainToken), 200, cors);
      }
      case '/api/checkin': {
        const b = await parseBody(req, bodies.checkin);
        return json(await service.checkin(b.mainToken, b.fix, b.purpose), 200, cors);
      }
      case '/api/privacy': {
        const b = await parseBody(req, bodies.privacy);
        return json(await service.downgradePrivacy(b.mainToken), 200, cors);
      }
      case '/api/config/get': {
        const b = await parseBody(req, bodies.configGet);
        return json(await service.configGet(b.configToken), 200, cors);
      }
      case '/api/config/save': {
        const b = await parseBody(req, bodies.configSave);
        return json(await service.configSave(b.configToken, b.config), 200, cors);
      }
      case '/api/capabilities': {
        const b = await parseBody(req, bodies.capabilities);
        return json(await service.capabilities(b), 200, cors);
      }
      case '/api/tracking/pair': {
        const b = await parseBody(req, bodies.tracking);
        const endpoint = `${(env.PUBLIC_URL ?? url.origin).replace(/\/$/, '')}/track/owntracks`;
        return json(await service.pairTracking(b.mainToken, endpoint), 200, cors);
      }
      case '/api/tracking/unpair': {
        const b = await parseBody(req, bodies.tracking);
        return json(await service.unpairTracking(b.mainToken), 200, cors);
      }
      case '/api/notify/setup': {
        const b = await parseBody(req, bodies.session);
        return json(await service.setupNotifications(b.mainToken), 200, cors);
      }
      case '/api/notify/test': {
        const b = await parseBody(req, bodies.session);
        return json(await service.testNotification(b.mainToken), 200, cors);
      }
      case '/api/hunt': {
        const b = await parseBody(req, bodies.hunt);
        return json(await service.huntAction(b.mainToken, b.action), 200, cors);
      }
      case '/api/mission': {
        const b = await parseBody(req, bodies.mission);
        return json(await service.missionAction(b.mainToken, b.action), 200, cors);
      }
      case '/api/notify/stop': {
        const b = await parseBody(req, bodies.session);
        return json(await service.stopNotifications(b.mainToken), 200, cors);
      }
      case '/api/notice/ack': {
        const b = await parseBody(req, bodies.session);
        return json(await service.ackRulesChanged(b.mainToken), 200, cors);
      }
      case '/track/owntracks': {
        // F14 – OwnTracks HTTP mode, Basic auth with the device credentials.
        const creds = parseBasicAuth(req.headers.get('Authorization'));
        if (!creds) throw new HttpError(401, 'unauthorized', 'Missing credentials.');
        const text = await req.text();
        let body: unknown = null;
        try {
          body = text ? JSON.parse(text) : null; // zero-length payloads are sent when a friend is deleted
        } catch {
          throw new HttpError(400, 'invalid_json', 'Body must be JSON.');
        }
        return json(await service.ingestOwnTracks(creds.user, creds.pass, body), 200, {});
      }
      case '/webhook': {
        if (!checkBasicAuth(env, req)) throw new HttpError(401, 'unauthorized', 'Invalid webhook credentials.');
        await handleWebhook(service, await req.json().catch(() => null));
        return json(null, 204, {});
      }
      default:
        throw new HttpError(404, 'not_found', 'Unknown endpoint.');
    }
  } catch (e) {
    if (e instanceof HttpError) {
      return json({ error: { code: e.code, message: e.message, details: e.details } }, e.status, cors);
    }
    console.error(e);
    return json({ error: { code: 'internal', message: 'Internal error' } }, 500, cors);
  }
}

/**
 * Cron, every minute:
 * - every 5th minute: full sweep over all locked sessions in batches (cursor in D1; free tier: 50 subrequests);
 * - otherwise: only sessions whose next due time (penalty, warning, unfreeze …) has come (due index in D1).
 */
export async function runCron(env: Env, o: Overrides = {}, budget = 40, opts: { full?: boolean } = {}): Promise<{ processed: number; changed: number; done: boolean; mode: 'full' | 'due' }> {
  let calls = 0;
  const baseFetch: FetchLike = o.fetch ?? ((i, init) => fetch(i, init));
  const counting: FetchLike = (i, init) => {
    calls += 1;
    return baseFetch(i, init);
  };
  const { client, store, service } = createService(env, { ...o, fetch: counting });
  const now = (o.now ?? (() => new Date()))();
  const full = opts.full ?? now.getUTCMinutes() % 5 === 0;
  let processed = 0;
  let changed = 0;

  if (!full) {
    // Every Chaster call of one tick costs ~3–6 subrequests; stay well within the budget.
    const ids = await store.dueSessions(new Date(now.getTime() + 30_000), Math.max(1, Math.floor(budget / 6)));
    for (const id of ids) {
      if (calls >= budget) break;
      try {
        if (await service.tickSessionById(id)) changed += 1;
      } catch (e) {
        console.error('due tick failed', id, e);
      }
      processed += 1;
    }
    return { processed, changed, done: true, mode: 'due' };
  }

  const slug = env.EXTENSION_SLUG ?? 'lockation';
  let cursor = await store.getSetting('cron:cursor');
  let done = false;
  while (calls < budget) {
    const page = await client.searchSessions(slug, cursor);
    for (const s of page.results) {
      if (calls >= budget) break;
      try {
        if (await service.tickSession(s)) changed += 1;
      } catch (e) {
        console.error('tick failed', sessionIdOf(s), e);
      }
      processed += 1;
      cursor = s.paginationId ?? sessionIdOf(s);
    }
    if (!page.hasMore) {
      cursor = null;
      done = true;
      break;
    }
  }
  await store.setSetting('cron:cursor', cursor);
  if (done) await store.pruneSent(new Date(now.getTime() - 7 * 86_400_000));
  return { processed, changed, done, mode: 'full' };
}

export default {
  fetch(req: Request, env: Env): Promise<Response> {
    return handleRequest(req, env);
  },
  scheduled(_controller: unknown, env: Env, ctx: ExecutionContextLike) {
    ctx.waitUntil(runCron(env));
  },
};
