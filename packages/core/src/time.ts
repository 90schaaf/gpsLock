/** Timezone aware helpers based on Intl (available in browsers and Cloudflare Workers). */

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;

export interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(tz, f);
  }
  return f;
}

export function localParts(date: Date, tz: string): LocalParts {
  const out: Record<string, number> = {};
  for (const p of formatter(tz).formatToParts(date)) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  return {
    year: out.year!,
    month: out.month!,
    day: out.day!,
    hour: out.hour! % 24,
    minute: out.minute!,
    second: out.second!,
  };
}

/** Calendar day key (YYYY-MM-DD) in the given timezone. */
export function dayKey(date: Date, tz: string): string {
  const p = localParts(date, tz);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

export function parseHHMM(v: string): number {
  const [h, m] = v.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export function isInQuietHours(date: Date, quiet: { start: string; end: string }, tz: string): boolean {
  const p = localParts(date, tz);
  const m = p.hour * 60 + p.minute;
  const s = parseHHMM(quiet.start);
  const e = parseHHMM(quiet.end);
  if (s === e) return false;
  return s < e ? m >= s && m < e : m >= s || m < e;
}

/**
 * If `date` falls into the quiet window, move it to the end of that window.
 * (DST transitions inside the window may shift the result by up to one hour – acceptable.)
 */
export function adjustForQuietHours(date: Date, quiet: { start: string; end: string } | undefined, tz: string): Date {
  if (!quiet || !isInQuietHours(date, quiet, tz)) return date;
  const p = localParts(date, tz);
  const m = p.hour * 60 + p.minute;
  const e = parseHHMM(quiet.end);
  const deltaMin = (e - m + 1440) % 1440;
  const subMinuteMs = p.second * 1000 + date.getUTCMilliseconds();
  return new Date(date.getTime() + deltaMin * MINUTE - subMinuteMs);
}

export function formatLocalTime(date: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

const WEEKDAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
const weekdayFormatters = new Map<string, Intl.DateTimeFormat>();

/** Weekday in the timezone, 0 = Monday … 6 = Sunday. */
export function weekdayIndex(date: Date, tz: string): number {
  let f = weekdayFormatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' });
    weekdayFormatters.set(tz, f);
  }
  const map: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
  return map[f.format(date)] ?? 0;
}

export interface WindowLike {
  start: string;
  end: string;
  days?: readonly string[];
}

/**
 * Start instant of the window instance active at `at`, or undefined if none is active.
 * Windows may cross midnight; such a window belongs to the day it starts (`days` filter).
 * `start === end` means a 24 h window. If several windows overlap, the latest start wins.
 */
export function activeWindowStart(windows: readonly WindowLike[], at: Date, tz: string): Date | undefined {
  if (!windows.length) return undefined;
  const p = localParts(at, tz);
  const m = p.hour * 60 + p.minute;
  const base = at.getTime() - (p.second * 1000 + at.getUTCMilliseconds());
  const wd = weekdayIndex(at, tz);
  let best: number | undefined;
  for (const w of windows) {
    const s = parseHHMM(w.start);
    const e = parseHHMM(w.end);
    const duration = (e - s + 1440) % 1440 || 1440;
    const candidates: [number, number][] = [];
    if (m >= s) candidates.push([m - s, wd]);
    candidates.push([m + 1440 - s, (wd + 6) % 7]);
    for (const [elapsed, day] of candidates) {
      if (elapsed >= duration) continue;
      if (w.days?.length && !w.days.includes(WEEKDAY_KEYS[day]!)) continue;
      const start = base - elapsed * MINUTE;
      if (best === undefined || start > best) best = start;
    }
  }
  return best === undefined ? undefined : new Date(best);
}

export function formatWindow(w: WindowLike): string {
  const days = w.days?.length && w.days.length < 7 ? ` (${w.days.map((d) => d[0]!.toUpperCase() + d.slice(1)).join(', ')})` : '';
  return `${w.start}–${w.end}${days}`;
}

/**
 * Wall-clock time in a timezone ("YYYY-MM-DDTHH:mm", as from <input type="datetime-local">) → UTC instant.
 * Uses the zone's offset at that moment (DST aware; for a non-existent/ambiguous hour the first match wins).
 */
export function zonedWallTimeToUtc(local: string, tz: string): Date | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local);
  if (!m) return undefined;
  const [y, mo, d, h, mi] = m.slice(1).map(Number) as [number, number, number, number, number];
  const asUtc = Date.UTC(y, mo - 1, d, h, mi);
  // Two passes converge for every real offset (also across DST changes).
  let t = asUtc;
  for (let i = 0; i < 2; i++) {
    const p = localParts(new Date(t), tz);
    const shown = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    t += asUtc - shown;
  }
  return new Date(t);
}

/** UTC instant → wall-clock "YYYY-MM-DDTHH:mm" in a timezone (for <input type="datetime-local">). */
export function utcToZonedWallTime(iso: string, tz: string): string {
  const p = localParts(new Date(iso), tz);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}
