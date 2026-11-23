/** F7 – map planned consequences to Chaster API calls. Failures never abort the others. */
import type { PlannedConsequence } from '@gps-lock/core';
import type { ChasterClient } from './chaster.js';

export interface AppliedResult {
  type: string;
  source: string;
  ok: boolean;
  error?: string;
}

export async function applyConsequence(client: ChasterClient, sessionId: string, p: PlannedConsequence): Promise<void> {
  const c = p.consequence;
  switch (c.type) {
    case 'add_time':
    case 'remove_time':
      return client.action(sessionId, { name: c.type, params: c.seconds });
    case 'freeze':
    case 'unfreeze':
      return client.action(sessionId, { name: c.type });
    case 'pillory':
      return client.action(sessionId, { name: 'pillory', params: { duration: c.durationMinutes * 60, reason: c.reason } });
    case 'log':
      return client.customLog(sessionId, { title: 'GPS Lock', description: c.message, icon: 'sticky-note' });
    case 'task':
      return client.assignTask(sessionId, {
        task: c.task,
        points: c.points,
        verificationRequired: c.verificationRequired,
        ...(c.durationMinutes ? { duration: c.durationMinutes * 60 } : {}),
      });
    case 'verification_picture':
      return client.requestVerificationPicture(sessionId);
    case 'command': {
      const r = await client.invokeCommand(sessionId, c.commandId, c.input, p.idempotencyKey);
      if (r && (r.status === 'failed' || r.status === 'rejected')) {
        throw new Error(r.error?.message ?? `command ${c.commandId} ${r.status}`);
      }
      return;
    }
  }
}

export async function applyAll(client: ChasterClient, sessionId: string, planned: PlannedConsequence[]): Promise<AppliedResult[]> {
  const results: AppliedResult[] = [];
  // Sequential on purpose: order matters (e.g. freeze then pillory) and keeps us within rate limits.
  for (const p of planned) {
    try {
      await applyConsequence(client, sessionId, p);
      results.push({ type: p.consequence.type, source: p.source, ok: true });
    } catch (e) {
      results.push({ type: p.consequence.type, source: p.source, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return results;
}
