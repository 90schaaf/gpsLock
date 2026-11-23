/** KV-backed check-in history (F9) and helpers. */
import type { CheckinRecord } from '@lockation/core';
import { redactRecord } from '@lockation/core';
import type { KVLike } from './types.js';

export const HISTORY_LIMIT = 200;
const historyKey = (sessionId: string) => `HISTORY:${sessionId}`;

export class HistoryStore {
  constructor(private kv: KVLike) {}

  async list(sessionId: string): Promise<CheckinRecord[]> {
    const v = (await this.kv.get(historyKey(sessionId), 'json')) as CheckinRecord[] | null;
    return Array.isArray(v) ? v : [];
  }

  async append(sessionId: string, record: CheckinRecord): Promise<CheckinRecord[]> {
    const list = [record, ...(await this.list(sessionId))].slice(0, HISTORY_LIMIT);
    // Expire 90 days after the last write as a safety net (normally purged by the delete webhook).
    await this.kv.put(historyKey(sessionId), JSON.stringify(list), { expirationTtl: 90 * 86_400 });
    return list;
  }

  async redact(sessionId: string): Promise<void> {
    const list = (await this.list(sessionId)).map(redactRecord);
    await this.kv.put(historyKey(sessionId), JSON.stringify(list), { expirationTtl: 90 * 86_400 });
  }

  purge(sessionId: string): Promise<void> {
    return this.kv.delete(historyKey(sessionId));
  }
}

/** Constant-time string comparison. */
export function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export interface DeviceRecord {
  sessionId: string;
  hash: string;
  createdAt: string;
}

/** F14 – OwnTracks device credentials. Only a SHA-256 hash of the password is stored. */
export class DeviceStore {
  constructor(private kv: KVLike) {}

  get(username: string): Promise<DeviceRecord | null> {
    return this.kv.get(`DEVICE:${username}`, 'json') as Promise<DeviceRecord | null>;
  }

  async create(sessionId: string, now: Date): Promise<{ username: string; password: string }> {
    await this.removeForSession(sessionId);
    const username = `gl${randomString(12)}`.toLowerCase();
    const password = randomString(24);
    const rec: DeviceRecord = { sessionId, hash: await sha256Hex(password), createdAt: now.toISOString() };
    await this.kv.put(`DEVICE:${username}`, JSON.stringify(rec));
    await this.kv.put(`SESSIONDEV:${sessionId}`, username);
    return { username, password };
  }

  async removeForSession(sessionId: string): Promise<void> {
    const old = await this.kv.get(`SESSIONDEV:${sessionId}`);
    if (old) await this.kv.delete(`DEVICE:${old}`);
    await this.kv.delete(`SESSIONDEV:${sessionId}`);
  }

  async verify(username: string, password: string): Promise<DeviceRecord | null> {
    const rec = await this.get(username);
    if (!rec) return null;
    return safeEqual(await sha256Hex(password), rec.hash) ? rec : null;
  }
}

export function randomString(len: number): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

export async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function parseBasicAuth(header: string | null): { user: string; pass: string } | null {
  if (!header?.startsWith('Basic ')) return null;
  try {
    const decoded = atob(header.slice(6));
    const i = decoded.indexOf(':');
    return i < 0 ? null : { user: decoded.slice(0, i), pass: decoded.slice(i + 1) };
  } catch {
    return null;
  }
}
