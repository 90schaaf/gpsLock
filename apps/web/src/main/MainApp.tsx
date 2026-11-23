import type { CheckinPurpose, CheckinRecord, Fix, SessionView } from '@gps-lock/core';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { LeafletMap, ZONE_COLORS, type MapCircle, type MapPoint } from '../components/LeafletMap.js';
import { ApiError, type Backend } from '../lib/backend.js';
import { GeoError, getFix } from '../lib/geolocation.js';
import { isEmbedded } from '../lib/hash.js';
import type { MockBackend } from '../lib/mock-backend.js';
import { TrackingCard } from './TrackingCard.js';

const REASON_TEXT: Record<string, string> = {
  rate_limited: 'Too many check-ins in a short time.',
  stale_fix: 'The GPS position was outdated.',
  future_fix: 'The GPS timestamp was in the future.',
  poor_accuracy: 'GPS accuracy was too low.',
  implausible_speed: 'Implausible movement since the last check-in.',
};

function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

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

const fmtTime = (iso: string | undefined, tz: string) =>
  iso ? new Intl.DateTimeFormat(undefined, { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' }).format(new Date(iso)) : '–';

export function MainApp({ backend, mock }: { backend: Backend; mock?: MockBackend }) {
  const [view, setView] = useState<SessionView>();
  const [error, setError] = useState<{ message: string; help?: string[]; frame?: boolean }>();
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<CheckinRecord>();
  const [myPos, setMyPos] = useState<Fix>();
  const [simulated, setSimulated] = useState<{ lat: number; lng: number }>();
  const [demoTick, setDemoTick] = useState(0);
  const now = useNow();
  const embedded = useMemo(isEmbedded, []);

  const load = () =>
    backend
      .session()
      .then((v) => {
        setView(v);
        setError(undefined);
      })
      .catch((e: unknown) => setError({ message: e instanceof Error ? e.message : String(e) }));

  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [demoTick]);

  async function checkin(purpose: CheckinPurpose) {
    setBusy(true);
    setError(undefined);
    try {
      let fix: Fix;
      if (backend.demo && simulated) fix = { ...simulated, accuracy: 8, timestamp: Date.now() };
      else fix = await getFix({ embedded });
      setMyPos(fix);
      const res = await backend.checkin(fix, purpose);
      setLast(res.record);
      setView(res.view);
    } catch (e) {
      if (e instanceof GeoError) setError({ message: e.message, help: e.help, frame: embedded });
      else if (e instanceof ApiError) setError({ message: e.message });
      else setError({ message: String(e) });
    } finally {
      setBusy(false);
    }
  }

  async function downgrade() {
    if (!confirm('Stop sharing exact coordinates for this lock? This cannot be undone while the lock is running.')) return;
    try {
      setView(await backend.downgradePrivacy());
    } catch (e) {
      setError({ message: e instanceof Error ? e.message : String(e) });
    }
  }

  const circles = useMemo<MapCircle[]>(() => {
    if (!view) return [];
    const out: MapCircle[] = view.zones.map((z) => {
      const kind = z.kinds.includes('forbidden') ? 'forbidden' : z.kinds.includes('required') ? 'required' : z.kinds.includes('reward') ? 'reward' : 'neutral';
      return { id: z.id, lat: z.lat, lng: z.lng, radiusM: z.radiusM, color: ZONE_COLORS[kind], label: `${z.name}${z.kinds.length ? ` (${z.kinds.join(', ')})` : ''}` };
    });
    if (view.hunt?.target) out.push({ id: 'hunt', ...view.hunt.target, color: ZONE_COLORS.hunt, label: 'Next checkpoint', dashed: true });
    return out;
  }, [view]);

  const points = useMemo<MapPoint[]>(() => {
    const p: MapPoint[] = [];
    if (view) {
      for (const h of view.history.slice(0, 30)) {
        if (h.lat !== undefined && h.lng !== undefined) p.push({ id: h.id, lat: h.lat, lng: h.lng, color: h.outcome === 'accepted' ? '#1e9e5a' : '#d64545', label: fmtTime(h.at, view.timezone) });
      }
    }
    if (simulated) p.push({ id: 'sim', ...simulated, color: ZONE_COLORS.me, label: 'Simulated position' });
    else if (myPos) p.push({ id: 'me', lat: myPos.lat, lng: myPos.lng, accuracy: myPos.accuracy, color: ZONE_COLORS.me, label: 'You' });
    return p;
  }, [view, myPos, simulated]);

  if (!view) {
    return (
      <div class="container">
        <header class="top"><h1>📍 GPS Lock</h1></header>
        {error ? <ErrorCard error={error} /> : <div class="card muted">Loading…</div>}
        {error && !backend.demo && (
          <div class="card small">
            Not opened from Chaster? Try the <a href="?demo">demo mode</a>.
          </div>
        )}
      </div>
    );
  }

  const isWearer = view.role === 'wearer';
  const req = view.required;
  const deadlineMs = req?.nextDeadline ? Date.parse(req.nextDeadline) - now : undefined;
  const huntActive = view.hunt?.status === 'active';

  return (
    <>
      {mock && (
        <DemoBar
          mock={mock}
          role={view.role}
          simulating={!!simulated}
          onClearSim={() => setSimulated(undefined)}
          onChange={() => {
            setLast(undefined);
            setDemoTick((n) => n + 1);
          }}
        />
      )}
      <div class="container">
        <header class="top">
          <h1>📍 GPS Lock</h1>
          <span class="badge accent">{isWearer ? 'Wearer' : 'Keyholder'}</span>
          <span class={`badge ${view.privacy === 'exact' ? 'warn' : ''}`} title="Coordinate sharing">
            {view.privacy === 'exact' ? 'Exact location shared' : 'Zones only'}
          </span>
        </header>

        {req && (
          <div class="card">
            <h2>⏱ Required check-in {req.overdue ? <span class="badge bad">overdue</span> : <span class="badge ok">on track</span>}</h2>
            <div class="countdown" style={{ color: req.overdue ? 'var(--bad)' : undefined }}>{deadlineMs !== undefined ? formatCountdown(deadlineMs) : '–'}</div>
            <div class="small muted">
              Due {fmtTime(req.nextDeadline, view.timezone)} · grace {req.graceMinutes} min · missed so far: {req.missedCount}
            </div>
          </div>
        )}

        {view.hunt && (
          <div class="card">
            <h2>🧭 Scavenger hunt <span class={`badge ${view.hunt.status === 'completed' ? 'ok' : view.hunt.status === 'failed' ? 'bad' : ''}`}>{view.hunt.status}</span></h2>
            <div class="progress" aria-label="hunt progress"><span style={{ width: `${(view.hunt.index / Math.max(1, view.hunt.total)) * 100}%` }} /></div>
            <p class="small muted">{view.hunt.index} of {view.hunt.total} checkpoints found{view.hunt.deadline ? ` · ends ${fmtTime(view.hunt.deadline, view.timezone)}` : ''}</p>
            {huntActive && (
              <>
                <p><strong>Hint:</strong> {view.hunt.hint || <span class="muted">no hint</span>}</p>
                {view.hunt.distanceBand && <p>Last guess: the checkpoint is <strong>{view.hunt.distanceBand}</strong> away.</p>}
              </>
            )}
          </div>
        )}

        {view.travel && (
          <div class="card">
            <h2>🚶 Travel</h2>
            <div class="progress"><span style={{ width: `${Math.min(100, (view.travel.pendingKm / view.travel.stepKm) * 100)}%` }} /></div>
            <p class="small muted">
              {view.travel.pendingKm.toFixed(2)} / {view.travel.stepKm} km to next goal · total {view.travel.totalKm.toFixed(2)} km · today {view.travel.kmToday.toFixed(1)} / {view.travel.dailyCapKm} km
            </p>
          </div>
        )}

        <TrackingCard view={view} backend={backend} onView={setView} onError={(message) => setError({ message })} />

        {view.freezeUntil && <div class="notice">❄️ Frozen by GPS Lock until {fmtTime(view.freezeUntil, view.timezone)}.</div>}

        {isWearer && (
          <div class="stack">
            {view.liveOnly ? (
              <div class="notice" data-testid="live-only">
                📡 <strong>Live tracking only.</strong> Manual check-ins are disabled for this lock – your location comes from OwnTracks in the background.
                {view.tracking && !view.tracking.paired && ' Set up background tracking above, otherwise every missing signal is penalised.'}
              </div>
            ) : (
              <button class="primary big" disabled={busy} onClick={() => checkin('general')}>
                {busy ? 'Getting your position…' : simulated ? '📍 Check in (simulated position)' : '📍 Check in now'}
              </button>
            )}
            {mock && view.tracking && simulated && (
              <button
                disabled={busy}
                onClick={async () => {
                  const res = await mock.track({ ...simulated, accuracy: 10, timestamp: Date.now() });
                  setLast(res.record);
                  setView(res.view);
                }}
              >
                📡 Demo: send as background update
              </button>
            )}
            {huntActive && !view.liveOnly && (
              <button disabled={busy} onClick={() => checkin('hunt')} title="A wrong guess may cost time">
                🧭 Submit hunt guess here
              </button>
            )}
            <p class="small muted" style={{ margin: 0 }}>
              {view.liveOnly ? 'Hunt checkpoints are found automatically when you walk into them.' : `Your accuracy must be ±${view.maxAccuracyM} m or better. Outdoors works best.`}
              {backend.demo && ' Demo: tap the map to simulate a position.'}
            </p>
          </div>
        )}

        {error && <ErrorCard error={error} />}
        {last && <ResultCard record={last} />}

        <LeafletMap
          circles={circles}
          points={points}
          fitKey={`${view.zones.length}-${view.hunt?.index}-${backend.demo ? demoTick : ''}`}
          onClick={backend.demo && isWearer ? (p) => setSimulated(p) : undefined}
        />
        <div class="row small muted">
          <span><span class="dot" style={{ background: ZONE_COLORS.required }} /> required</span>
          <span><span class="dot" style={{ background: ZONE_COLORS.forbidden }} /> forbidden</span>
          <span><span class="dot" style={{ background: ZONE_COLORS.reward }} /> reward</span>
          <span><span class="dot" style={{ background: ZONE_COLORS.hunt }} /> next checkpoint</span>
        </div>

        <div class="card">
          <h2>📜 Rules of this lock</h2>
          {view.rules.length === 0 && <p class="muted">No GPS rules are enabled.</p>}
          {view.rules.map((r) => (
            <div key={r.rule}>
              <h3>{r.title}</h3>
              <ul>
                {r.lines.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            </div>
          ))}
          <p class="small muted">Zone matching: {view.matchMode === 'strict' ? 'strict – your whole accuracy circle must be inside' : 'your position must be inside the zone'}.</p>
        </div>

        <div class="card">
          <h2>🕘 History</h2>
          {view.history.length === 0 ? (
            <p class="muted">No check-ins yet.</p>
          ) : (
            <ul class="plain history">
              {view.history.slice(0, 50).map((h) => (
                <li key={h.id}>
                  <div class="row">
                    <span class={`badge ${h.outcome === 'accepted' ? 'ok' : 'bad'}`}>{h.outcome}</span>
                    <span class="small">{fmtTime(h.at, view.timezone)}</span>
                    <span class="small muted">±{h.accuracy} m</span>
                    {h.zones.length > 0 && <span class="small">{h.zones.join(', ')}</span>}
                    {h.flagged && <span class="badge warn">flagged</span>}
                    {h.source === 'tracked' && <span class="badge">background</span>}
                  </div>
                  <div class="small muted">{h.events.join(' ')}</div>
                  {h.consequences.length > 0 && (
                    <div class="small">
                      → {h.consequences.map((c) => `${c.description}${c.ok === false ? ' (failed)' : ''}`).join(', ')}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div class="card">
          <h2>🔒 Privacy</h2>
          {view.privacy === 'exact' ? (
            <>
              <p class="small">Exact coordinates of each check-in are stored and visible to the keyholder.</p>
              {isWearer && (
                <button class="danger" onClick={downgrade}>
                  Stop sharing exact coordinates
                </button>
              )}
            </>
          ) : (
            <p class="small">
              Only the zones you were in are stored – no coordinates. {view.privacyLocked ? 'Exact sharing was disabled by the wearer.' : ''}
            </p>
          )}
          <p class="small muted">All stored location history is deleted when the lock ends.</p>
        </div>

        <footer class="small muted">
          GPS Lock beta · <a href="../guide/" target="_blank" rel="noopener">User guide</a>
        </footer>
      </div>
    </>
  );
}

function ErrorCard({ error }: { error: { message: string; help?: string[]; frame?: boolean } }) {
  return (
    <div class="card error" role="alert">
      <strong>{error.message}</strong>
      {error.help && (
        <ul class="small">
          {error.help.map((h) => (
            <li key={h}>{h}</li>
          ))}
        </ul>
      )}
      {error.frame && (
        <button onClick={() => window.open(window.location.href, '_blank', 'noopener')}>Open in new tab</button>
      )}
    </div>
  );
}

function ResultCard({ record }: { record: CheckinRecord }) {
  return (
    <div class={`card result ${record.outcome}`} aria-live="polite">
      <h2>
        {record.source === 'tracked' ? (record.outcome === 'accepted' ? '📡 Background update' : '📡 Background update ignored') : record.outcome === 'accepted' ? '✅ Check-in accepted' : '⛔ Check-in rejected'}
        <span class="badge">±{record.accuracy} m</span>
      </h2>
      {record.reason && <p>{REASON_TEXT[record.reason]}</p>}
      <ul>
        {record.events.map((e) => (
          <li key={e}>{e}</li>
        ))}
      </ul>
      {record.consequences.length > 0 && (
        <>
          <h3>Consequences</h3>
          <ul>
            {record.consequences.map((c, i) => (
              <li key={i}>
                {c.description} {c.ok === false && <span class="error small">– failed: {c.error}</span>}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function DemoBar({ mock, role, simulating, onClearSim, onChange }: { mock: MockBackend; role: string; simulating: boolean; onClearSim: () => void; onChange: () => void }) {
  const [showLog, setShowLog] = useState(false);
  return (
    <div>
      <div class="demo-bar">
        <strong>DEMO</strong>
        <span>no Chaster account needed – data stays in this browser</span>
        <span class="grow" />
        <button onClick={() => { mock.setRole(role === 'wearer' ? 'keyholder' : 'wearer'); onChange(); }}>View as {role === 'wearer' ? 'keyholder' : 'wearer'}</button>
        {simulating && <button onClick={onClearSim}>Use real GPS</button>}
        <button
          onClick={() =>
            getFix()
              .then((f) => mock.reset(f))
              .catch(() => mock.reset())
              .finally(onChange)
          }
        >
          Reset around me
        </button>
        <a class="btn" href={`config.html${location.search}`}>Edit config</a>
        <button onClick={() => setShowLog((s) => !s)}>{showLog ? 'Hide' : 'Show'} Chaster log</button>
      </div>
      {showLog && (
        <div class="container">
          <div class="card small">
            <h2>Simulated Chaster lock history</h2>
            {mock.demoLog().length === 0 && <p class="muted">Empty.</p>}
            <ul class="plain">
              {mock.demoLog().map((l, i) => (
                <li key={i}>
                  <strong>{l.title}</strong> <span class="muted">{new Date(l.at).toLocaleTimeString()}</span>
                  <div style={{ whiteSpace: 'pre-line' }}>{l.description}</div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
