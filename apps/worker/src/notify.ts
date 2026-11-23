/**
 * Push notifications via ntfy (https://ntfy.sh). JSON publishing (no header encoding issues), authenticated with an
 * access token. Wearer notices are warnings; keyholder notices are filtered by the lock's switches, deduplicated,
 * rate limited (per kind and zone, 5 min) and combined into one message per evaluation.
 */
import type { LockationConfig, Notice } from '@lockation/core';
import type { FetchLike } from './chaster.js';
import type { Audience, Store } from './store.js';

export const KEYHOLDER_RATE_MS = 5 * 60_000;

export interface NtfyMessage {
  title: string;
  message: string;
  priority?: 'default' | 'high';
  click?: string;
  tags?: string[];
}

export class Ntfy {
  constructor(
    private base: string,
    private token: string,
    private fetchImpl: FetchLike,
  ) {}

  static from(env: { NTFY_BASE?: string; NTFY_TOKEN?: string }, fetchImpl: FetchLike): Ntfy | undefined {
    return env.NTFY_TOKEN ? new Ntfy((env.NTFY_BASE ?? 'https://ntfy.sh').replace(/\/$/, ''), env.NTFY_TOKEN, fetchImpl) : undefined;
  }

  get host(): string {
    return this.base.replace(/^https?:\/\//, '');
  }

  links(topic: string) {
    return { url: `${this.base}/${topic}`, deepLink: `ntfy://${this.host}/${topic}` };
  }

  async send(topic: string, m: NtfyMessage): Promise<void> {
    const res = await this.fetchImpl(this.base, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.token}` },
      body: JSON.stringify({
        topic,
        title: m.title.slice(0, 200),
        message: m.message.slice(0, 2000),
        priority: m.priority === 'high' ? 4 : 3,
        ...(m.click ? { click: m.click } : {}),
        ...(m.tags?.length ? { tags: m.tags } : {}),
      }),
    });
    if (!res.ok) throw new Error(`ntfy ${res.status}`);
  }
}

/** Deliver the notices of one evaluation. Never throws (notifications must not break rule processing). */
export async function deliverNotices(opts: {
  ntfy: Ntfy | undefined;
  store: Store;
  sessionId: string;
  config: LockationConfig;
  isSelfLock: boolean;
  notices: Notice[];
  now: Date;
  click?: string;
}): Promise<number> {
  const { ntfy, store, sessionId, config, notices, now } = opts;
  if (!ntfy || !notices.length) return 0;
  let sent = 0;
  const send = async (role: Audience, m: NtfyMessage) => {
    const topic = await store.topic(sessionId, role);
    if (!topic) return;
    try {
      await ntfy.send(topic, { ...m, click: opts.click });
      sent += 1;
    } catch (e) {
      console.error('ntfy failed', e);
    }
  };
  try {
    for (const n of notices.filter((x) => x.audience === 'wearer')) {
      if (!(await store.markSent(sessionId, `w:${n.key}`, now))) continue;
      await send('wearer', { title: n.title, message: n.message, priority: n.priority, tags: ['warning'] });
    }
    if (opts.isSelfLock) return sent;
    const switches = config.notifications.keyholder;
    const lines: Notice[] = [];
    for (const n of notices.filter((x) => x.audience === 'keyholder')) {
      if (!n.kind || !switches[n.kind]) continue;
      if (!(await store.markSent(sessionId, `k:${n.key}`, now))) continue;
      if (!(await store.markSent(sessionId, `rate:${n.kind}:${n.zoneId ?? ''}`, now, KEYHOLDER_RATE_MS))) continue;
      lines.push(n);
    }
    if (lines.length === 1) await send('keyholder', { title: lines[0]!.title, message: lines[0]!.message, priority: lines[0]!.priority });
    else if (lines.length > 1) await send('keyholder', { title: 'Lockation', message: lines.map((l) => `• ${l.message}`).join('\n') });
  } catch (e) {
    console.error('notify failed', e);
  }
  return sent;
}
