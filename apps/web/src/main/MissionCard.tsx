import type { SessionView } from '@lockation/core';
import { useState } from 'preact/hooks';
import type { Backend } from '../lib/backend.js';
import type { MockBackend } from '../lib/mock-backend.js';
import { clockTime, formatCountdown, useNow } from '../lib/time-ui.js';

const OUTCOME: Record<string, string> = { success: '✅ accomplished', failed: '❌ failed', declined: '↩ declined', cancelled: '✕ cancelled' };

/** F25 – the running surprise mission (countdown, decline) and, for the keyholder, sending one. */
export function MissionCard({ view, backend, mock, onView, onError }: { view: SessionView; backend: Backend; mock?: MockBackend; onView: (v: SessionView) => void; onError: (m: string) => void }) {
  const m = view.mission!;
  const now = useNow();
  const [busy, setBusy] = useState(false);
  const [zoneId, setZoneId] = useState(m.targets?.[0]?.id ?? '');
  const [minutes, setMinutes] = useState(m.leadMinutes);
  const act = async (fn: () => Promise<SessionView>) => {
    setBusy(true);
    try {
      onView(await fn());
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const a = m.active;
  const left = a ? Date.parse(a.dueAt) - now : 0;
  return (
    <div class={`card${a ? ' mission-active' : ''}`} data-testid="mission-card">
      <h2>🎯 Surprise mission {a && <span class={`badge ${left < 10 * 60_000 ? 'bad' : 'warn'}`}>{left > 0 ? formatCountdown(left) : 'time is up'}</span>}</h2>
      {a ? (
        <>
          <p style={{ margin: 0 }} data-testid="mission-active">
            Be at <strong>{a.zoneName}</strong> by <strong>{clockTime(a.dueAt, view.timezone, now)}</strong>
            {a.by === 'keyholder' ? ' – sent by the keyholder.' : '.'}
          </p>
          <p class="small muted" style={{ margin: 0 }}>Arrival counts by check-in{view.tracking ? ' or background location' : ''}. The zone is highlighted on the map.</p>
          <div class="row">
            {m.actions.includes('decline') && (
              <button disabled={busy} data-testid="mission-decline" onClick={() => confirm("Decline this mission? (Can't right now – no penalty, the keyholder is told.)") && act(() => backend.missionAction({ type: 'decline' }))}>
                ↩ Can't right now ({m.declinesLeft} left today)
              </button>
            )}
            {m.actions.includes('cancel') && (
              <button disabled={busy} data-testid="mission-cancel" onClick={() => act(() => backend.missionAction({ type: 'cancel' }))}>
                ✕ Cancel mission
              </button>
            )}
          </div>
          {view.role === 'wearer' && !m.actions.includes('decline') && <p class="small muted" style={{ margin: 0 }}>No more declines today.</p>}
        </>
      ) : (
        <p class="small muted" style={{ margin: 0 }}>
          {m.random ? `No mission right now – the next one comes at a random time (${m.activeHours}).` : 'No mission right now.'}
          {m.last ? ` Last: ${m.last.zoneName} ${OUTCOME[m.last.outcome]}.` : ''}
        </p>
      )}
      {m.actions.includes('send') && m.targets && (
        <div class="row" data-testid="mission-send">
          <select value={zoneId} aria-label="mission zone" onChange={(e) => setZoneId((e.target as HTMLSelectElement).value)}>
            {m.targets.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
          <input type="number" min={5} max={720} style={{ width: '80px' }} aria-label="minutes to get there" value={minutes} onInput={(e) => setMinutes(Number((e.target as HTMLInputElement).value))} />
          <span class="small muted">min</span>
          <button class="primary" disabled={busy || !zoneId} onClick={() => act(() => backend.missionAction({ type: 'send', zoneId, minutes }))}>
            🎯 Send mission
          </button>
        </div>
      )}
      {mock && !a && (
        <div class="row">
          <button disabled={busy} data-testid="mission-demo" onClick={() => act(() => mock.demoMissionNow())}>
            🎲 Random mission now (demo)
          </button>
        </div>
      )}
      <p class="small muted" style={{ margin: 0 }}>
        {m.stats.succeeded} accomplished · {m.stats.failed} failed · {m.stats.declined} declined
      </p>
    </div>
  );
}
