/** Thin client for the Chaster Extensions API. All calls use the secret developer token. */
import type { ChasterMetadata } from '@gps-lock/core';
import { HttpError } from './types.js';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface ChasterLock {
  _id: string;
  status: string;
  keyholder?: unknown | null;
  startDate?: string;
  isFrozen?: boolean;
}

export interface ChasterSession {
  _id?: string;
  sessionId: string;
  slug?: string;
  config: unknown;
  data: Record<string, unknown> | null;
  lock: ChasterLock;
  createdAt?: string;
}

export interface SessionAuth {
  role: 'wearer' | 'keyholder';
  session: ChasterSession;
  lockForUser: unknown;
  userId: string;
}

export interface ConfigurationAuth {
  config: unknown;
  role: 'wearer' | 'keyholder';
  user: string;
  sessionId: string | null;
  extensionSlug: string;
}

export interface CapabilityCommand {
  id: string;
  title: string;
  description: string;
  available: boolean;
  invocableBy: string[];
  inputSchema: unknown;
  reason?: string | null;
}

export interface LockActionBody {
  name: 'add_time' | 'remove_time' | 'freeze' | 'unfreeze' | 'pillory';
  params?: number | { duration: number; reason: string };
}

export class ChasterClient {
  constructor(
    private token: string,
    private base = 'https://api.chaster.app',
    private fetchImpl: FetchLike = (i, init) => fetch(i, init),
  ) {}

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.fetchImpl(`${this.base}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json: unknown = undefined;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = text;
    }
    if (!res.ok) {
      const message =
        (json && typeof json === 'object' && 'message' in json ? String((json as { message: unknown }).message) : '') || res.statusText;
      throw new HttpError(res.status === 401 || res.status === 404 ? res.status : 502, 'chaster_error', `Chaster API ${method} ${path}: ${res.status} ${message}`, json);
    }
    return json as T;
  }

  authSession(mainToken: string) {
    return this.request<SessionAuth>('GET', `/api/extensions/auth/sessions/${encodeURIComponent(mainToken)}`);
  }

  getConfiguration(token: string) {
    return this.request<ConfigurationAuth>('GET', `/api/extensions/configurations/${encodeURIComponent(token)}`);
  }

  putConfiguration(token: string, config: unknown) {
    return this.request<ConfigurationAuth>('PUT', `/api/extensions/configurations/${encodeURIComponent(token)}`, { config });
  }

  async getSession(sessionId: string): Promise<ChasterSession> {
    const r = await this.request<{ session: ChasterSession }>('GET', `/api/extensions/sessions/${sessionId}`);
    return r.session;
  }

  searchSessions(slug: string, paginationLastId: string | null, limit = 15) {
    return this.request<{ hasMore: boolean; results: (ChasterSession & { paginationId?: string })[] }>('POST', '/api/extensions/sessions/search', {
      status: 'locked',
      extensionSlug: slug,
      limit,
      paginationLastId,
    });
  }

  setData(sessionId: string, data: Record<string, unknown>) {
    return this.request<void>('PUT', `/api/extensions/sessions/${sessionId}/data`, { data });
  }

  setMetadata(sessionId: string, metadata: ChasterMetadata) {
    return this.request<void>('PUT', `/api/extensions/sessions/${sessionId}/metadata`, { metadata });
  }

  action(sessionId: string, action: LockActionBody) {
    return this.request<void>('POST', `/api/extensions/sessions/${sessionId}/action`, { action });
  }

  customLog(sessionId: string, entry: { title: string; description: string; color?: string; icon?: string; role?: string }) {
    return this.request<void>('POST', `/api/extensions/sessions/${sessionId}/logs/custom`, { role: 'extension', ...entry });
  }

  assignTask(sessionId: string, task: { task: string; points: number; verificationRequired?: boolean; duration?: number }) {
    return this.request<void>('POST', `/api/extensions/sessions/${sessionId}/tasks/assign`, { task, actor: 'extension' });
  }

  requestVerificationPicture(sessionId: string) {
    return this.request<void>('POST', `/api/extensions/sessions/${sessionId}/verification-picture/request`, { actor: 'extension' });
  }

  invokeCommand(sessionId: string, commandId: string, input: Record<string, unknown>, idempotencyKey: string) {
    return this.request<{ status: string; error?: { message?: string } | null }>(
      'POST',
      `/api/extensions/sessions/${sessionId}/actions/${encodeURIComponent(commandId)}`,
      { actor: 'extension', input, idempotencyKey: idempotencyKey.slice(0, 200) },
    );
  }

  async capabilities(sessionId: string): Promise<{ slug: string; displayName: string; commands: CapabilityCommand[] }[]> {
    const r = await this.request<{ extensions: { slug: string; displayName: string; commands: CapabilityCommand[] }[] }>(
      'GET',
      `/api/extensions/sessions/${sessionId}/capabilities`,
    );
    return r.extensions ?? [];
  }
}

export function sessionIdOf(s: ChasterSession): string {
  return s.sessionId ?? s._id ?? '';
}
