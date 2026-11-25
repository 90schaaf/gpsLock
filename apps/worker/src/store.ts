/** D1-backed storage: history (F9), OwnTracks devices (F14), ntfy topics, due index, sent notifications, settings. */
import type { CheckinRecord } from '@lockation/core';
import type { D1Like } from './types.js';

export const HISTORY_LIMIT = 200;

export interface DeviceRecord {
  sessionId: string;
  hash: string;
  createdAt: string;
}

export type Audience = 'wearer' | 'keyholder';

export class Store {
  constructor(private db: D1Like) {}

  private run(sql: string, ...args: unknown[]) {
    return this.db.prepare(sql).bind(...args).run();
  }
  private async all<T>(sql: string, ...args: unknown[]): Promise<T[]> {
    const r = await this.db.prepare(sql).bind(...args).all<T>();
    return r.results ?? [];
  }
  private first<T>(sql: string, ...args: unknown[]): Promise<T | null> {
    return this.db.prepare(sql).bind(...args).first<T>();
  }

  // ---------- history ----------
  async listHistory(sessionId: string): Promise<CheckinRecord[]> {
    const rows = await this.all<{ record: string }>('SELECT record FROM history WHERE session_id = ? ORDER BY rowid DESC LIMIT ?', sessionId, HISTORY_LIMIT);
    return rows.map((r) => JSON.parse(r.record) as CheckinRecord);
  }

  async appendHistory(sessionId: string, record: CheckinRecord): Promise<void> {
    await this.run('INSERT OR REPLACE INTO history (session_id, id, at, record) VALUES (?, ?, ?, ?)', sessionId, record.id, record.at, JSON.stringify(record));
    await this.run(
      'DELETE FROM history WHERE session_id = ? AND rowid NOT IN (SELECT rowid FROM history WHERE session_id = ? ORDER BY rowid DESC LIMIT ?)',
      sessionId,
      sessionId,
      HISTORY_LIMIT,
    );
  }

  /** Remove coordinates from all records of a session (privacy downgrade). */
  async redactHistory(sessionId: string): Promise<void> {
    await this.run("UPDATE history SET record = json_remove(record, '$.lat', '$.lng') WHERE session_id = ?", sessionId);
  }

  // ---------- devices ----------
  async createDevice(sessionId: string, now: Date): Promise<{ username: string; password: string }> {
    await this.removeDevice(sessionId);
    const username = `lo${randomString(12)}`.toLowerCase();
    const password = randomString(24);
    await this.run('INSERT INTO devices (username, session_id, hash, created_at) VALUES (?, ?, ?, ?)', username, sessionId, await sha256Hex(password), now.toISOString());
    return { username, password };
  }

  async removeDevice(sessionId: string): Promise<void> {
    await this.run('DELETE FROM devices WHERE session_id = ?', sessionId);
  }

  async verifyDevice(username: string, password: string): Promise<DeviceRecord | null> {
    const row = await this.first<{ session_id: string; hash: string; created_at: string }>('SELECT session_id, hash, created_at FROM devices WHERE username = ?', username);
    if (!row) return null;
    return safeEqual(await sha256Hex(password), row.hash) ? { sessionId: row.session_id, hash: row.hash, createdAt: row.created_at } : null;
  }

  // ---------- ntfy topics ----------
  async createTopic(sessionId: string, role: Audience, now: Date): Promise<string> {
    const topic = `lockation-${randomString(32)}`;
    await this.run('INSERT OR REPLACE INTO topics (session_id, role, topic, created_at) VALUES (?, ?, ?, ?)', sessionId, role, topic, now.toISOString());
    return topic;
  }

  async topic(sessionId: string, role: Audience): Promise<string | null> {
    const row = await this.first<{ topic: string }>('SELECT topic FROM topics WHERE session_id = ? AND role = ?', sessionId, role);
    return row?.topic ?? null;
  }

  async removeTopic(sessionId: string, role: Audience): Promise<void> {
    await this.run('DELETE FROM topics WHERE session_id = ? AND role = ?', sessionId, role);
  }

  // ---------- due index ----------
  async setDue(sessionId: string, at: Date | undefined): Promise<void> {
    if (!at) await this.run('DELETE FROM due WHERE session_id = ?', sessionId);
    else await this.run('INSERT OR REPLACE INTO due (session_id, next_at) VALUES (?, ?)', sessionId, at.getTime());
  }

  async dueSessions(upTo: Date, limit: number): Promise<string[]> {
    const rows = await this.all<{ session_id: string }>('SELECT session_id FROM due WHERE next_at <= ? ORDER BY next_at LIMIT ?', upTo.getTime(), limit);
    return rows.map((r) => r.session_id);
  }

  // ---------- sent notifications ----------
  /** Records `key` and returns true if it wasn't sent within `windowMs` (dedupe / rate limit). */
  async markSent(sessionId: string, key: string, now: Date, windowMs = Number.POSITIVE_INFINITY): Promise<boolean> {
    const row = await this.first<{ at: number }>('SELECT at FROM sent WHERE session_id = ? AND key = ?', sessionId, key);
    if (row && now.getTime() - row.at < windowMs) return false;
    await this.run('INSERT OR REPLACE INTO sent (session_id, key, at) VALUES (?, ?, ?)', sessionId, key, now.getTime());
    return true;
  }

  async pruneSent(olderThan: Date): Promise<void> {
    await this.run('DELETE FROM sent WHERE at < ?', olderThan.getTime());
  }

  // ---------- settings ----------
  async getSetting(key: string): Promise<string | null> {
    return (await this.first<{ value: string }>('SELECT value FROM kv WHERE key = ?', key))?.value ?? null;
  }

  async setSetting(key: string, value: string | null): Promise<void> {
    if (value === null) await this.run('DELETE FROM kv WHERE key = ?', key);
    else await this.run('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)', key, value);
  }

  // ---------- toys (F27) ----------
  async toyWebhook(sessionId: string): Promise<string | undefined> {
    const row = await this.first<{ webhook_id: string }>('SELECT webhook_id FROM toys WHERE session_id = ?', sessionId);
    return row?.webhook_id ?? undefined;
  }

  async setToyWebhook(sessionId: string, webhookId: string | null, now: Date): Promise<void> {
    if (webhookId === null) await this.run('DELETE FROM toys WHERE session_id = ?', sessionId);
    else await this.run('INSERT OR REPLACE INTO toys (session_id, webhook_id, created_at) VALUES (?, ?, ?)', sessionId, webhookId, now.toISOString());
  }

  // ---------- session end ----------
  async purgeSession(sessionId: string): Promise<void> {
    for (const t of ['history', 'devices', 'topics', 'due', 'sent', 'toys']) {
      await this.run(`DELETE FROM ${t} WHERE session_id = ?`, sessionId);
    }
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
