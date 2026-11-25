/** Pure helpers of the configuration page (zone roles, forbidden-zone timeline). Unit-tested without DOM. */
import { fmtMinutes, ZoneSchema, type ForbiddenTimings, type Zone, type ZoneRole } from '@lockation/core';

export type RoleChoice = ZoneRole | 'neutral';

const ORDER: ZoneRole[] = ['required', 'reward', 'forbidden', 'surprise'];
/** Roles that exclude every other role. */
const EXCLUSIVE: ZoneRole[] = ['forbidden', 'surprise'];

/**
 * Toggle one role chip. Allowed results: required and/or reward, OR forbidden, OR neutral (no role).
 * - `neutral` clears all roles;
 * - `forbidden` replaces every other role (or is removed again);
 * - `required` / `reward` toggle themselves and remove `forbidden`.
 */
export function toggleRole(roles: readonly ZoneRole[], choice: RoleChoice): ZoneRole[] {
  if (choice === 'neutral') return [];
  if (EXCLUSIVE.includes(choice)) return roles.includes(choice) ? [] : [choice];
  const set = new Set<ZoneRole>(roles.filter((r) => !EXCLUSIVE.includes(r)));
  if (set.has(choice)) set.delete(choice);
  else set.add(choice);
  return ORDER.filter((r) => set.has(r));
}

export function isValidRoleSet(roles: readonly ZoneRole[]): boolean {
  if (new Set(roles).size !== roles.length) return false;
  return !(roles.some((r) => EXCLUSIVE.includes(r)) && roles.length > 1);
}

/** Default per-zone settings block of a role (schema defaults). */
export function defaultRoleSettings<R extends ZoneRole>(role: R): Zone[R] {
  return ZoneSchema.shape[role].parse(undefined) as Zone[R];
}

const canon = (v: unknown) => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).filter(([, y]) => y !== undefined).sort(([a], [b]) => a.localeCompare(b))) : x));

/** Whether the zone has per-zone settings for this role that differ from the defaults. */
export function hasRoleSettings(zone: Zone, role: ZoneRole): boolean {
  return canon(zone[role]) !== canon(defaultRoleSettings(role));
}

/** Roles that would be dropped (and whose per-zone settings would be lost) by changing to `next`. */
export function droppedRolesWithSettings(zone: Zone, next: readonly ZoneRole[]): ZoneRole[] {
  return zone.roles.filter((r) => !next.includes(r) && hasRoleSettings(zone, r));
}

/**
 * Returns a copy of the zone with the new roles: dropped roles get their default settings back, and a newly
 * forbidden zone without an explicit match mode gets `strict` (suggested for forbidden zones).
 */
export function applyRoles(zone: Zone, next: readonly ZoneRole[]): Zone {
  const z: Zone = JSON.parse(JSON.stringify(zone)) as Zone;
  for (const r of zone.roles) {
    if (!next.includes(r)) (z as Record<ZoneRole, unknown>)[r] = defaultRoleSettings(r);
  }
  if (next.includes('forbidden') && !zone.roles.includes('forbidden') && !zone.matchMode) z.matchMode = 'strict';
  z.roles = [...next];
  return z;
}

/** Number of penalties during a continuous stay of `minutes` (with background tracking). */
export function penaltiesForStay(t: ForbiddenTimings, minutes: number): number {
  if (minutes < t.firstPenalty) return 0;
  return 1 + Math.floor((minutes - t.firstPenalty) / t.repeatEvery);
}

/** "enter 0′ → ⚠ 2′ → ❌ 10′ → ⚠ 11′ → ❌ 15′ → … – 1 h inside = 11 penalties" */
export function forbiddenTimeline(t: ForbiddenTimings, steps = 3): string {
  const parts = ['enter 0′'];
  if (t.firstWarning !== null) parts.push(`⚠ ${t.firstWarning}′`);
  for (let i = 0; i < steps; i++) {
    const at = t.firstPenalty + i * t.repeatEvery;
    parts.push(`❌ ${at}′`);
    if (i < steps - 1 && t.repeatWarning !== null) parts.push(`⚠ ${at + t.repeatWarning}′`);
  }
  parts.push('…');
  const n = penaltiesForStay(t, 60);
  return `${parts.join(' → ')} – 1 h inside = ${n} ${n === 1 ? 'penalty' : 'penalties'}`;
}

/** Hint for the editor: "Warning after 2 h 30 min without signal, penalty after 3 h". */
export function heartbeatWarningText(heartbeatMinutes: number, warnBefore: number | undefined): string {
  if (!warnBefore || warnBefore >= heartbeatMinutes) return `Penalty after ${fmtMinutes(heartbeatMinutes)} without signal.`;
  return `Warning after ${fmtMinutes(heartbeatMinutes - warnBefore)} without signal, penalty after ${fmtMinutes(heartbeatMinutes)}.`;
}
