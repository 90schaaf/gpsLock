import type { Env, KVLike } from '../src/types.js';
import type { ChasterSession } from '../src/chaster.js';

export class MemoryKV implements KVLike {
  map = new Map<string, string>();
  async get(key: string, type?: 'json'): Promise<any> {
    const v = this.map.get(key) ?? null;
    return type === 'json' && v !== null ? JSON.parse(v) : v;
  }
  async put(key: string, value: string) {
    this.map.set(key, value);
  }
  async delete(key: string) {
    this.map.delete(key);
  }
}

export interface Call {
  method: string;
  path: string;
  body: any;
}

/** In-memory imitation of the parts of the Chaster Extensions API we use. */
export class FakeChaster {
  sessions = new Map<string, ChasterSession>();
  mainTokens = new Map<string, { role: 'wearer' | 'keyholder'; sessionId: string }>();
  configTokens = new Map<string, { config: unknown; role: 'wearer' | 'keyholder'; sessionId: string | null }>();
  calls: Call[] = [];
  failActions = new Set<string>();
  capabilities: unknown[] = [];

  addSession(id: string, config: unknown, opts: { keyholder?: boolean; status?: string; start?: string } = {}) {
    const s: ChasterSession = {
      sessionId: id,
      slug: 'gps-lock',
      config,
      data: {},
      lock: { _id: `lock-${id}`, status: opts.status ?? 'locked', keyholder: opts.keyholder === false ? null : { username: 'kh' }, startDate: opts.start ?? '2026-06-01T10:00:00.000Z' },
    };
    this.sessions.set(id, s);
    return s;
  }

  get fetch() {
    return async (input: string, init?: RequestInit): Promise<Response> => {
      const url = new URL(input);
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      const path = url.pathname;
      if (!String((init?.headers as Record<string, string>)?.Authorization).startsWith('Bearer ')) return this.res(401, { message: 'no token' });
      this.calls.push({ method, path, body });
      let m: RegExpMatchArray | null;

      if ((m = path.match(/^\/api\/extensions\/auth\/sessions\/(.+)$/))) {
        const t = this.mainTokens.get(decodeURIComponent(m[1]!));
        if (!t) return this.res(404, { message: 'Session not found' });
        const s = this.sessions.get(t.sessionId)!;
        return this.res(200, { role: t.role, session: structuredClone(s), lockForUser: {}, userId: 'u1' });
      }
      if ((m = path.match(/^\/api\/extensions\/configurations\/(.+)$/))) {
        const t = this.configTokens.get(decodeURIComponent(m[1]!));
        if (!t) return this.res(404, { message: 'Configuration not found' });
        if (method === 'PUT') t.config = body.config;
        return this.res(200, { ...t, user: 'u1', extensionSlug: 'gps-lock', createdAt: '' });
      }
      if (path === '/api/extensions/sessions/search') {
        const all = [...this.sessions.values()].filter((s) => s.lock.status === 'locked');
        const start = body.paginationLastId ? all.findIndex((s) => s.sessionId === body.paginationLastId) + 1 : 0;
        const page = all.slice(start, start + body.limit);
        return this.res(200, { count: all.length, hasMore: start + body.limit < all.length, results: page.map((s) => ({ ...structuredClone(s), paginationId: s.sessionId })) });
      }
      if ((m = path.match(/^\/api\/extensions\/sessions\/([^/]+)(\/.*)?$/))) {
        const s = this.sessions.get(m[1]!);
        if (!s) return this.res(404, { message: 'not found' });
        const sub = m[2] ?? '';
        if (sub === '' && method === 'GET') return this.res(200, { session: structuredClone(s) });
        if (sub === '/data') {
          s.data = body.data;
          return this.res(200, {});
        }
        if (sub === '/metadata') {
          (s as any).metadata = body.metadata;
          return this.res(200, {});
        }
        if (sub === '/capabilities') return this.res(200, { extensions: this.capabilities });
        if (sub === '/action' || sub.startsWith('/actions/') || sub === '/tasks/assign' || sub === '/verification-picture/request') {
          const name = body?.action?.name ?? sub;
          if (this.failActions.has(name)) return this.res(400, { message: `${name} failed` });
          return this.res(200, sub.startsWith('/actions/') ? { status: 'succeeded' } : {});
        }
        if (sub === '/logs/custom') return this.res(201, {});
      }
      return this.res(404, { message: `fake: unknown ${method} ${path}` });
    };
  }

  actionCalls() {
    return this.calls.filter((c) => /\/(action|actions\/.+|tasks\/assign|verification-picture\/request)$/.test(c.path));
  }

  private res(status: number, body: unknown) {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  }
}

export function makeEnv(kv = new MemoryKV()): Env {
  return {
    KV: kv,
    CHASTER_TOKEN: 'dev-token',
    CHASTER_API_BASE: 'https://api.chaster.test',
    ALLOWED_ORIGINS: 'https://user.github.io',
    EXTENSION_SLUG: 'gps-lock',
    WEBHOOK_USERNAME: 'hook',
    WEBHOOK_PASSWORD: 'secret',
  };
}
