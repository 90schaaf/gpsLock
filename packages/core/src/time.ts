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
