/** F17 – runs debounced reachability checks for all zones and checkpoints of the config page. */
import { useEffect, useRef, useState } from 'preact/hooks';
import { cacheKey, type Place, type ReachStatus } from '../lib/reachability.js';

export type PlaceRef = Place & { id: string };
export type ReachCheck = (p: Place) => Promise<ReachStatus>;

export function useReachability(places: PlaceRef[], check: ReachCheck | null, onResult: (id: string, status: ReachStatus) => void, debounceMs = 1200) {
  const [statuses, setStatuses] = useState<Record<string, ReachStatus>>({});
  const wanted = useRef<Record<string, string>>({});
  const scheduled = useRef<Record<string, string>>({});
  const todo = useRef(new Map<string, PlaceRef>());
  const running = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const resultCb = useRef(onResult);
  resultCb.current = onResult;
  const signature = places.map((p) => `${p.id}@${cacheKey(p)}`).join('|');

  useEffect(() => {
    if (!check) return;
    const next: Record<string, string> = {};
    for (const p of places) next[p.id] = cacheKey(p);
    wanted.current = next;
    const changed = places.filter((p) => scheduled.current[p.id] !== next[p.id]);
    for (const id of Object.keys(scheduled.current)) if (!(id in next)) delete scheduled.current[id];
    for (const p of changed) {
      scheduled.current[p.id] = next[p.id]!;
      todo.current.set(p.id, p);
    }
    setStatuses((s) => {
      const o: Record<string, ReachStatus> = {};
      for (const [id, st] of Object.entries(s)) if (id in next) o[id] = st;
      for (const p of changed) o[p.id] = { state: 'pending' };
      return o;
    });
    if (!changed.length) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void drain(), debounceMs);
  }, [signature, check]);

  useEffect(() => () => clearTimeout(timer.current), []);

  async function drain() {
    if (running.current || !check) return;
    running.current = true;
    try {
      while (todo.current.size) {
        const [id, p] = todo.current.entries().next().value as [string, PlaceRef];
        todo.current.delete(id);
        const key = cacheKey(p);
        if (wanted.current[id] !== key) continue;
        const status = await check(p);
        if (wanted.current[id] !== key) continue; // moved again meanwhile – a newer check is queued
        setStatuses((s) => ({ ...s, [id]: status }));
        resultCb.current(id, status);
      }
    } finally {
      running.current = false;
    }
  }

  return statuses;
}
