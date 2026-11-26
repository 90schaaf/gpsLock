/** F7 – consequences that rules can trigger. */
import { z } from 'zod';
import { TOY_SHAPES, TOY_TYPES, ToyKeepSchema, ToyTargetSchema } from './toys.js';

export const MAX_TIME_SECONDS = 31_536_000; // one year

const seconds = z.number().int().min(1).max(MAX_TIME_SECONDS);

const BaseConsequenceSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('add_time'), seconds }),
  z.object({ type: z.literal('remove_time'), seconds }),
  z.object({ type: z.literal('freeze'), durationMinutes: z.number().int().min(1).max(43_200).optional() }),
  z.object({ type: z.literal('unfreeze') }),
  z.object({
    type: z.literal('pillory'),
    durationMinutes: z.number().int().min(5).max(1440),
    reason: z.string().min(1).max(500),
  }),
  z.object({ type: z.literal('log'), message: z.string().min(1).max(500) }),
  z.object({
    type: z.literal('task'),
    task: z.string().min(1).max(200),
    points: z.number().int().min(0).max(10_000).default(0),
    verificationRequired: z.boolean().default(false),
    durationMinutes: z.number().int().min(1).max(1440).optional(),
  }),
  z.object({ type: z.literal('verification_picture') }),
  /** F27 – toy action via XToys, sent to every connected toy that matches `target` (clamped to the wearer's limits). */
  z.object({
    type: z.literal('toy'),
    action: z.enum(['play', 'intensity', 'shock', 'stop']),
    target: ToyTargetSchema,
    shape: z.enum(TOY_SHAPES).optional(),
    intensity: z.number().int().min(0).max(100).optional(),
    /** Relative intensity change (action `intensity`), e.g. +10 / −20. */
    delta: z.number().int().min(-100).max(100).optional(),
    seconds: z.number().int().min(1).max(3600).optional(),
    /** `play` only: keep running until the situation ends (instead of `seconds`). */
    keep: ToyKeepSchema.optional(),
  }),
  z.object({
    type: z.literal('command'),
    commandId: z.string().regex(/^[a-z0-9-]+\.[a-z0-9-_.]+$/, 'commandId must look like "<extension>.<command>"'),
    input: z.record(z.unknown()).default({}),
    label: z.string().max(100).optional(),
  }),
]);

/**
 * When a consequence applies inside a repeating list (e.g. forbidden-zone repeat penalties):
 * every time (default), every n-th time, or only at the n-th time.
 */
export const WhenSchema = z.union([
  z.object({ every: z.literal(true) }),
  z.object({ everyNth: z.number().int().min(2).max(1000) }),
  z.object({ nth: z.number().int().min(1).max(1000) }),
]);
export type When = z.infer<typeof WhenSchema>;

export const ConsequenceSchema = BaseConsequenceSchema.and(z.object({ when: WhenSchema.optional() }));

export type Consequence = z.infer<typeof ConsequenceSchema>;

/** Whether a consequence with a `when` schedule applies at occurrence `n` (1-based). */
export function appliesAt(c: Consequence, n: number): boolean {
  const w = c.when;
  if (!w || 'every' in w) return true;
  if ('everyNth' in w) return n % w.everyNth === 0;
  return n === w.nth;
}

export function describeWhen(w: When | undefined): string {
  if (!w || 'every' in w) return '';
  if ('everyNth' in w) return ` (every ${w.everyNth}. time)`;
  return ` (only the ${w.nth}. time)`;
}
export type ConsequenceType = Consequence['type'];

export const ConsequenceListSchema = z.array(ConsequenceSchema).max(10).default([]);

/** Scale time based consequences by `factor` (travel steps, repeated misses). Others stay once. */
export function scaleConsequence(c: Consequence, factor: number): Consequence {
  if ((c.type === 'add_time' || c.type === 'remove_time') && factor > 1) {
    return { ...c, seconds: Math.min(MAX_TIME_SECONDS, c.seconds * factor) };
  }
  return c;
}

const KEEP_TEXT = { leave: 'until leaving the zone', return: 'until back in the zone', released: 'until released' } as const;

/** "until leaving the zone (at most 2h)" / "for 30m, kept running". */
export function keepText(k: { until: 'leave' | 'return' | 'released' | 'time'; minutes?: number }): string {
  if (k.until === 'time') return `for ${formatDuration((k.minutes ?? 30) * 60)}, kept running`;
  return `${KEEP_TEXT[k.until]}${k.minutes ? ` (at most ${formatDuration(k.minutes * 60)})` : ''}`;
}

export function formatDuration(totalSeconds: number): string {
  const s = Math.round(totalSeconds);
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const parts: string[] = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  if (!parts.length) parts.push(`${s}s`);
  return parts.join(' ');
}

/** Human readable one-line description, used in logs and UI. */
export function describeConsequence(c: Consequence): string {
  switch (c.type) {
    case 'add_time':
      return `add ${formatDuration(c.seconds)}`;
    case 'remove_time':
      return `remove ${formatDuration(c.seconds)}`;
    case 'freeze':
      return c.durationMinutes ? `freeze for ${formatDuration(c.durationMinutes * 60)}` : 'freeze';
    case 'unfreeze':
      return 'unfreeze';
    case 'pillory':
      return `pillory for ${formatDuration(c.durationMinutes * 60)}`;
    case 'log':
      return `note: ${c.message}`;
    case 'task':
      return `task: ${c.task}`;
    case 'verification_picture':
      return 'verification picture';
    case 'command':
      return c.label ?? `run ${c.commandId}`;
    case 'toy': {
      const who = `${c.target.toyType ? TOY_TYPES[c.target.toyType].label.toLowerCase() : 'toys'}${c.target.bodyPart === 'all' ? '' : ` – ${c.target.bodyPart}`}${c.target.channel ? ` ${c.target.channel}` : ''}`;
      if (c.action === 'play' && c.keep) return `🎮 ${c.shape ?? 'pulse'} ${c.intensity ?? 50} % ${keepText(c.keep)} (${who})`;
      if (c.action === 'play') return `🎮 ${c.shape ?? 'pulse'} ${c.intensity ?? 50} % for ${formatDuration(c.seconds ?? 30)} (${who})`;
      if (c.action === 'intensity') return `🎮 intensity ${c.delta !== undefined ? `${c.delta >= 0 ? '+' : ''}${c.delta} %` : `${c.intensity ?? 50} %`} (${who})`;
      if (c.action === 'shock') return `🎮 shock ${c.intensity ?? 30} % (${who})`;
      return `🎮 stop (${who})`;
    }
  }
}
