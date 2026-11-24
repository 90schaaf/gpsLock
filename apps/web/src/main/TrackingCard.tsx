/** F14 – background tracking status and OwnTracks pairing. */
import type { SessionView, TrackingStatus } from '@lockation/core';
import qrcode from 'qrcode-generator';
import { useEffect, useMemo, useState } from 'preact/hooks';
import type { Backend, PairingResult } from '../lib/backend.js';
import { clockTime, formatCountdown, useNow } from '../lib/time-ui.js';

export const OWNTRACKS_IOS = 'https://apps.apple.com/app/owntracks/id692424691';
export const OWNTRACKS_ANDROID = 'https://play.google.com/store/apps/details?id=org.owntracks.android';

export function qrSvg(text: string): string {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
}

const STATUS: Record<TrackingStatus, { label: string; cls: string }> = {
  not_set_up: { label: 'not set up', cls: 'warn' },
  waiting: { label: 'waiting for first location', cls: 'warn' },
  connected: { label: 'connected', cls: 'ok' },
  no_signal: { label: 'no signal', cls: 'bad' },
};

const MODE_NAME = { move: 'Move', significant: 'Significant' } as const;

const ago = (iso?: string) => {
  if (!iso) return 'never';
  const m = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
};

export function TrackingCard({ view, backend, onView, onError }: { view: SessionView; backend: Backend; onView: (v: SessionView) => void; onError: (msg: string) => void }) {
  const t = view.tracking;
  const [pairing, setPairing] = useState<PairingResult>();
  const [busy, setBusy] = useState(false);
  const svg = useMemo(() => (pairing ? qrSvg(pairing.link) : ''), [pairing]);
  if (!t) return null;
  const isWearer = view.role === 'wearer';

  async function pair() {
    if (t?.paired && !confirm('Create new credentials? The currently connected phone stops working until it is set up again.')) return;
    setBusy(true);
    try {
      const p = await backend.pairTracking();
      setPairing(p);
      onView(p.view);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function unpair() {
    if (!confirm('Stop background tracking? Missing locations may be penalised by the lock rules.')) return;
    setBusy(true);
    try {
      onView(await backend.unpairTracking());
      setPairing(undefined);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div class="card stack">
      <h2>
        📡 Background tracking
        <span class={`badge ${STATUS[t.status].cls}`} data-testid="tracking-status">{STATUS[t.status].label}</span>
      </h2>
      {t.status === 'waiting' && t.receiving && (
        <div class="small notice" style={{ margin: 0 }} data-testid="tracking-receiving">
          Locations are arriving – <strong>tap ↑ (publish) once in OwnTracks</strong> to finish the setup. The status turns{' '}
          <em>connected</em> with that manual send.
        </div>
      )}
      {t.status === 'waiting' && !t.receiving && (
        <div class="small notice" style={{ margin: 0 }}>
          Set up, but no location has arrived from your phone yet. Open OwnTracks and tap <strong>↑</strong> (publish) to send
          your position once, and check that location access is set to <strong>"Always"</strong>. The setup is complete with that
          first manual send.
          <br />
          OwnTracks status still shows <code>mqtts://user@host</code>? The setup wasn't imported – on iPhone turn on{' '}
          <strong>ⓘ → Settings → Remote control → ⓘ → "Allow external configuration"</strong>, then <em>Set up again</em>, or use{' '}
          <em>Manual setup</em>.
        </div>
      )}
      {t.status === 'no_signal' && (
        <div class="small notice" style={{ margin: 0 }}>
          No location from your phone for more than {Math.round((t.heartbeatMinutes / 60) * 10) / 10} h. Open OwnTracks and check
          battery saving, location permission and network.
        </div>
      )}
      <div class="small muted">
        Last location: {ago(t.lastSeenAt)} · {t.updates} updates · missing signal after {Math.round(t.heartbeatMinutes / 60 * 10) / 10} h
        {t.missedCount > 0 && ` · missed ${t.missedCount}×`}
      </div>
      <SignalCountdown view={view} />
      {view.presentZones.length > 0 && <div class="small">Currently in: {view.presentZones.join(', ')}</div>}
      {t.mode && isWearer && (
        <div class="small" data-testid="tracking-mode">
          Keep OwnTracks in <strong>{MODE_NAME[t.mode]}</strong> mode
          {t.mode === 'move' ? ' (frequent reports – this lock needs them; uses more battery).' : ' (battery saving).'}
        </div>
      )}

      {isWearer && !pairing && (
        <>
          {!t.paired && (
            <ol class="small" style={{ margin: 0, paddingLeft: '18px' }}>
              <li>
                Install <strong>OwnTracks</strong> (free): <a href={OWNTRACKS_IOS} target="_blank" rel="noopener">iPhone</a> ·{' '}
                <a href={OWNTRACKS_ANDROID} target="_blank" rel="noopener">Android</a>
              </li>
              <li>
                <strong>iPhone only, once:</strong> in OwnTracks tap <strong>ⓘ → Settings → Remote control → ⓘ</strong> and turn on{' '}
                <strong>"Allow external configuration"</strong> (section <em>From device</em>). Otherwise OwnTracks ignores the setup link.
              </li>
              <li>Tap <em>Set up</em> below, open the link in OwnTracks and confirm <strong>"Process Configuration"</strong>.</li>
              <li>In OwnTracks tap <strong>↑</strong> (publish) once – the setup is complete when this first manual location arrives.</li>
              <li>Allow location <strong>"Always"</strong> and keep precise location on.</li>
            </ol>
          )}
          <div class="row">
            <button class={t.paired ? '' : 'primary'} disabled={busy} onClick={pair}>
              {t.paired ? '🔁 Set up again (new credentials)' : '📡 Set up background tracking'}
            </button>
            {t.paired && (
              <button class="danger" disabled={busy} onClick={unpair}>
                Stop background tracking
              </button>
            )}
          </div>
        </>
      )}

      {isWearer && pairing && <PairingWatcher backend={backend} onView={onView} connected={t.status === 'connected'} />}
      {isWearer && pairing && (
        <div class="stack">
          <a class="btn primary" href={pairing.link} style={{ justifyContent: 'center' }}>
            📲 Open in OwnTracks
          </a>
          <p class="small muted" style={{ margin: 0 }}>
            On another device? Scan this code with the phone's camera. The credentials are shown only once.
          </p>
          <p class="small notice" style={{ margin: 0 }} data-testid="ios-external-config">
            <strong>iPhone:</strong> if no <em>"Process Configuration"</em> question appears, OwnTracks blocks setup links. In OwnTracks tap{' '}
            <strong>ⓘ → Settings → Remote control → ⓘ</strong>, turn on <strong>"Allow external configuration"</strong>, then open the link
            again (you can switch it off afterwards). Check: OwnTracks' status must show an address starting with <code>https://</code>, not{' '}
            <code>mqtts://user@host</code>.
          </p>
          <div style={{ maxWidth: '220px', background: '#fff', padding: '6px', borderRadius: '8px' }} dangerouslySetInnerHTML={{ __html: svg }} />
          <details class="small">
            <summary>Manual setup</summary>
            <p>Works without "Allow external configuration". OwnTracks → ⓘ → Settings: Mode <strong>HTTP</strong>, then:</p>
            <ul>
              <li>URL: <code>{pairing.url}</code></li>
              <li>Authentication on, username <code>{pairing.username}</code>, password <code>{pairing.password}</code></li>
              <li>Monitoring mode: <strong>{MODE_NAME[t.mode ?? 'significant']}</strong></li>
            </ul>
            <button onClick={() => navigator.clipboard?.writeText(`${pairing.url}\n${pairing.username}\n${pairing.password}`)}>Copy settings</button>
          </details>
          <details class="small">
            <summary>Tips for reliable tracking</summary>
            <ul>
              <li>iPhone: Settings → OwnTracks → Location → <strong>Always</strong>, Precise Location on, Background App Refresh on.</li>
              <li>Android: App info → OwnTracks → Location → <strong>Allow all the time</strong>; Battery → <strong>Unrestricted</strong>.</li>
              <li>Don't force-close OwnTracks.</li>
            </ul>
          </details>
          <button class="link" onClick={() => setPairing(undefined)}>Done</button>
        </div>
      )}
      {!isWearer && !t.paired && <p class="small">The wearer has not connected a phone yet.</p>}
    </div>
  );
}

/**
 * Live countdown to the latest time the next location must arrive, or – once that has passed – how long it is delayed
 * and when the next missing-signal penalty is due. Only shown once a phone is set up.
 */
export function SignalCountdown({ view, nowMs }: { view: SessionView; nowMs?: number }) {
  const ticking = useNow(1000);
  const now = nowMs ?? ticking;
  const t = view.tracking;
  if (!t || !t.paired || !t.signalDueAt) return null;
  const due = Date.parse(t.signalDueAt);
  const tz = view.timezone;
  if (now < due) {
    return (
      <div class="small" data-testid="signal-countdown">
        ⏱ Next location expected by <strong>{clockTime(t.signalDueAt, tz, now)}</strong> · in <strong>{formatCountdown(due - now)}</strong>
      </div>
    );
  }
  const next = t.nextHeartbeat ? Date.parse(t.nextHeartbeat) : NaN;
  return (
    <div class="small warn-text" data-testid="signal-countdown">
      ⚠ Location delayed by <strong>{formatCountdown(now - due)}</strong> (expected by {clockTime(t.signalDueAt, tz, now)})
      {Number.isFinite(next) && next > now && (
        <>
          {' '}· next missing-signal penalty {clockTime(t.nextHeartbeat!, tz, now)} · in {formatCountdown(next - now)}
        </>
      )}
    </div>
  );
}

/** While the setup panel is open: reload every 5 s until the first manual location arrives, then show the success. */
export function PairingWatcher({ backend, onView, connected, intervalMs = 5000 }: { backend: Backend; onView: (v: SessionView) => void; connected: boolean; intervalMs?: number }) {
  useEffect(() => {
    if (connected) return;
    const t = setInterval(() => {
      backend.session().then(onView, () => undefined);
    }, intervalMs);
    return () => clearInterval(t);
  }, [connected, intervalMs]);
  if (connected) {
    return (
      <div class="card small" data-testid="tracking-setup-ok" style={{ borderColor: 'var(--ok)' }}>
        ✅ <strong>Setup complete</strong> – your phone sent its first location. Lockation now receives your position in the background.
      </div>
    );
  }
  return (
    <p class="small muted" style={{ margin: 0 }} data-testid="tracking-setup-wait">
      ⏳ Waiting for the first manual location from OwnTracks (tap ↑ in the app)…
    </p>
  );
}
