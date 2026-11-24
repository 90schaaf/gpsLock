/** Small time helpers shared by the check-in page components. */
import { useEffect, useState } from 'preact/hooks';

/** Re-renders every `intervalMs` and returns the current time (ms). */
export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

/** hh:mm:ss (with days), negative values get a minus sign. */
export function formatCountdown(ms: number): string {
  const neg = ms < 0;
  let s = Math.floor(Math.abs(ms) / 1000);
  const d = Math.floor(s / 86400);
  s -= d * 86400;
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  s -= m * 60;
  const core = `${d ? `${d}d ` : ''}${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return neg ? `−${core}` : core;
}

/** Clock time in the lock's timezone, with weekday if not today. */
export function clockTime(iso: string, tz: string, now = Date.now()): string {
  const d = new Date(iso);
  const sameDay = new Intl.DateTimeFormat('en-CA', { timeZone: tz, dateStyle: 'short' }).format(d) === new Intl.DateTimeFormat('en-CA', { timeZone: tz, dateStyle: 'short' }).format(new Date(now));
  return new Intl.DateTimeFormat(undefined, { timeZone: tz, hour: '2-digit', minute: '2-digit', ...(sameDay ? {} : { weekday: 'short' }) }).format(d);
}
