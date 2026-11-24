/**
 * Human readable summary of configuration changes during a running lock (shown to the wearer, written to the history).
 * Hidden hunt checkpoints are never described in detail.
 */
import { forbiddenTimings, type LockationConfig, type Zone } from './config.js';
import { describeConsequence, type Consequence } from './consequences.js';
import { haversineM } from './geo.js';
import { formatWindow } from './time.js';
import { fmtMinutes } from './view.js';

const cons = (cs: Consequence[]) => (cs.length ? cs.map(describeConsequence).join(', ') : 'nothing');
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const roleText = (z: Zone) => (z.roles.length ? z.roles.join(' + ') : 'neutral');

export function diffConfig(before: LockationConfig, after: LockationConfig): string[] {
  const out: string[] = [];
  const oldZones = new Map(before.zones.map((z) => [z.id, z]));
  const newZones = new Map(after.zones.map((z) => [z.id, z]));

  for (const z of after.zones) {
    const o = oldZones.get(z.id);
    if (!o) {
      out.push(`Zone "${z.name}" added (${roleText(z)}, ${Math.round(z.radiusM)} m).`);
      continue;
    }
    if (o.name !== z.name) out.push(`Zone "${o.name}" renamed to "${z.name}".`);
    if (!same(o.roles, z.roles)) out.push(`Zone "${z.name}": role ${roleText(o)} → ${roleText(z)}.`);
    if (haversineM(o, z) > 5) out.push(`Zone "${z.name}" moved by ${Math.round(haversineM(o, z))} m.`);
    if (o.radiusM !== z.radiusM) out.push(`Zone "${z.name}": radius ${Math.round(o.radiusM)} m → ${Math.round(z.radiusM)} m.`);
    if ((o.matchMode ?? before.matchMode) !== (z.matchMode ?? after.matchMode)) out.push(`Zone "${z.name}": matching ${o.matchMode ?? before.matchMode} → ${z.matchMode ?? after.matchMode}.`);
    if (z.roles.includes('required')) {
      const ri = (c: LockationConfig, x: Zone) => x.required.intervalMinutes ?? c.rules.required.intervalMinutes;
      const rg = (c: LockationConfig, x: Zone) => x.required.graceMinutes ?? c.rules.required.graceMinutes;
      if (ri(before, o) !== ri(after, z)) out.push(`"${z.name}" check-in interval ${fmtMinutes(ri(before, o))} → ${fmtMinutes(ri(after, z))}.`);
      if (rg(before, o) !== rg(after, z)) out.push(`"${z.name}" grace period ${fmtMinutes(rg(before, o))} → ${fmtMinutes(rg(after, z))}.`);
      if (o.required.intervalCheckins !== z.required.intervalCheckins) out.push(`"${z.name}": interval check-ins ${z.required.intervalCheckins ? 'on' : 'off'}.`);
      if (!same(o.required.stayWindows, z.required.stayWindows)) {
        out.push(`"${z.name}" stay-inside windows: ${z.required.stayWindows.length ? z.required.stayWindows.map(formatWindow).join(', ') : 'none'}.`);
      }
      if (!same(o.required.onMissed, z.required.onMissed)) out.push(`"${z.name}" extra penalty when missed: ${cons(z.required.onMissed)}.`);
    }
    if (z.roles.includes('forbidden')) {
      const a = forbiddenTimings(before, o);
      const b = forbiddenTimings(after, z);
      if (!same(a, b)) out.push(`"${z.name}" forbidden-zone timing changed (first penalty after ${fmtMinutes(b.firstPenalty)}, then every ${fmtMinutes(b.repeatEvery)}).`);
      if (!same(o.forbidden.windows, z.forbidden.windows)) out.push(`"${z.name}" forbidden ${z.forbidden.windows.length ? `during ${z.forbidden.windows.map(formatWindow).join(', ')}` : 'at all times'}.`);
      if (!same(o.forbidden.onEnter, z.forbidden.onEnter)) out.push(`"${z.name}" extra punishment: ${cons(z.forbidden.onEnter)}.`);
    }
    if (z.roles.includes('reward') && !same(o.reward, z.reward)) out.push(`"${z.name}" reward settings changed.`);
    if (!same(o.actions, z.actions)) {
      const a = z.actions;
      out.push(`"${z.name}" zone actions: entering ${cons(a.onEnter)}; leaving ${cons(a.onLeave)}${a.minStayMinutes ? ` (after ${fmtMinutes(a.minStayMinutes)})` : ''}.`);
    }
  }
  for (const o of before.zones) if (!newZones.has(o.id)) out.push(`Zone "${o.name}" removed.`);

  const R0 = before.rules;
  const R1 = after.rules;
  for (const k of ['required', 'forbidden', 'reward', 'travel', 'hunt'] as const) {
    if (R0[k].enabled !== R1[k].enabled) out.push(`${label(k)} ${R1[k].enabled ? 'enabled' : 'disabled'}.`);
  }
  const rq0 = R0.required;
  const rq1 = R1.required;
  if (rq1.enabled) {
    if (rq0.intervalMinutes !== rq1.intervalMinutes) out.push(`Default check-in interval ${fmtMinutes(rq0.intervalMinutes)} → ${fmtMinutes(rq1.intervalMinutes)}.`);
    if (rq0.graceMinutes !== rq1.graceMinutes) out.push(`Default grace period ${fmtMinutes(rq0.graceMinutes)} → ${fmtMinutes(rq1.graceMinutes)}.`);
    if (rq0.anywhere !== rq1.anywhere) out.push(`Check-ins anywhere ${rq1.anywhere ? 'required' : 'no longer required'}.`);
    if (rq0.combine !== rq1.combine) out.push(rq1.combine === 'each' ? 'Each required zone now has its own deadline.' : 'Required zones now share one deadline.');
    if (!same(rq0.quietHours, rq1.quietHours)) out.push(`Quiet hours: ${rq1.quietHours ? `${rq1.quietHours.start}–${rq1.quietHours.end}` : 'none'}.`);
    if (!same(rq0.onMissed, rq1.onMissed)) out.push(`Missed check-in: ${cons(rq1.onMissed)}.`);
    if (!same(rq0.onSuccess, rq1.onSuccess)) out.push(`Successful check-in: ${cons(rq1.onSuccess)}.`);
    if (!same(rq0.onOutside, rq1.onOutside)) out.push(`Check-in outside the required zones: ${cons(rq1.onOutside)}.`);
    if (!same(rq0.onOutsideDuringWindow, rq1.onOutsideDuringWindow)) out.push(`Outside during a stay window: ${cons(rq1.onOutsideDuringWindow)}.`);
  }
  if (R1.forbidden.enabled && !same(R0.forbidden.onEnter, R1.forbidden.onEnter)) out.push(`Forbidden zones penalty: ${cons(R1.forbidden.onEnter)}.`);
  if (R1.reward.enabled && !same(R0.reward, R1.reward) && R0.reward.enabled) out.push('Reward settings changed.');
  if (R1.travel.enabled && !same(R0.travel, R1.travel) && R0.travel.enabled) out.push(`Travel goals: every ${R1.travel.stepKm} km: ${cons(R1.travel.onStep)}.`);
  if (R1.hunt.enabled && R0.hunt.enabled && !same(R0.hunt, R1.hunt)) {
    // Never reveal hidden checkpoints – only say that something changed.
    if (!same(R0.hunt.checkpoints, R1.hunt.checkpoints)) out.push('Hunt checkpoints changed.');
    const { checkpoints: _a, ...h0 } = R0.hunt;
    const { checkpoints: _b, ...h1 } = R1.hunt;
    if (!same(h0, h1)) out.push('Hunt settings changed.');
  }
  const t0 = before.tracking;
  const t1 = after.tracking;
  if (t0.enabled !== t1.enabled) out.push(`Background tracking ${t1.enabled ? 'required' : 'no longer required'}.`);
  if (t1.enabled) {
    if (t0.heartbeatMinutes !== t1.heartbeatMinutes) out.push(`Missing signal after ${fmtMinutes(t0.heartbeatMinutes)} → ${fmtMinutes(t1.heartbeatMinutes)}.`);
    if (!same(t0.onHeartbeatMissed, t1.onHeartbeatMissed)) out.push(`Missing signal: ${cons(t1.onHeartbeatMissed)}.`);
    if (t0.checkins !== t1.checkins) out.push({ auto: 'Manual check-ins disabled (background tracking only).', both: 'Manual check-ins and background locations count.', manual: 'Required zones need manual check-ins.' }[t1.checkins]);
    if (!same(t0.quietHours, t1.quietHours)) out.push(`Missing-signal quiet hours: ${t1.quietHours ? `${t1.quietHours.start}–${t1.quietHours.end}` : 'none'}.`);
    if (t0.owntracksMode !== t1.owntracksMode) out.push(`OwnTracks mode: ${t1.owntracksMode}.`);
  }
  if (!same(before.antiCheat, after.antiCheat)) out.push('Anti-cheat settings changed.');
  if (before.privacy.coordinates !== after.privacy.coordinates) out.push(`Location sharing: ${after.privacy.coordinates === 'exact' ? 'exact' : 'zones only'}.`);
  if (before.matchMode !== after.matchMode) out.push(`Default zone matching: ${after.matchMode}.`);
  if (before.timezone !== after.timezone) out.push(`Timezone: ${after.timezone}.`);
  return out.slice(0, 50);
}

function label(k: string): string {
  return { required: 'Required zones', forbidden: 'Forbidden zones', reward: 'Reward zones', travel: 'Travel goals', hunt: 'Scavenger hunt' }[k] ?? k;
}
