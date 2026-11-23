/** F14 – background tracking status and OwnTracks pairing. */
import type { SessionView } from '@lockation/core';
import qrcode from 'qrcode-generator';
import { useMemo, useState } from 'preact/hooks';
import type { Backend, PairingResult } from '../lib/backend.js';

export const OWNTRACKS_IOS = 'https://apps.apple.com/app/owntracks/id692424691';
export const OWNTRACKS_ANDROID = 'https://play.google.com/store/apps/details?id=org.owntracks.android';

export function qrSvg(text: string): string {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
}

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
        {t.paired ? <span class={`badge ${t.overdue ? 'bad' : 'ok'}`}>{t.overdue ? 'no signal' : 'connected'}</span> : <span class="badge warn">not set up</span>}
      </h2>
      <div class="small muted">
        Last location: {ago(t.lastSeenAt)} · {t.updates} updates · missing signal after {Math.round(t.heartbeatMinutes / 60 * 10) / 10} h
        {t.missedCount > 0 && ` · missed ${t.missedCount}×`}
      </div>
      {view.presentZones.length > 0 && <div class="small">Currently in: {view.presentZones.join(', ')}</div>}

      {isWearer && !pairing && (
        <>
          {!t.paired && (
            <ol class="small" style={{ margin: 0, paddingLeft: '18px' }}>
              <li>
                Install <strong>OwnTracks</strong> (free): <a href={OWNTRACKS_IOS} target="_blank" rel="noopener">iPhone</a> ·{' '}
                <a href={OWNTRACKS_ANDROID} target="_blank" rel="noopener">Android</a>
              </li>
              <li>Tap <em>Set up</em> below and open the link in OwnTracks.</li>
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

      {isWearer && pairing && (
        <div class="stack">
          <a class="btn primary" href={pairing.link} style={{ justifyContent: 'center' }}>
            📲 Open in OwnTracks
          </a>
          <p class="small muted" style={{ margin: 0 }}>
            On another device? Scan this code with the phone's camera. The credentials are shown only once.
          </p>
          <div style={{ maxWidth: '220px', background: '#fff', padding: '6px', borderRadius: '8px' }} dangerouslySetInnerHTML={{ __html: svg }} />
          <details class="small">
            <summary>Manual setup</summary>
            <p>OwnTracks → Settings → Connection: Mode <strong>HTTP</strong>, then:</p>
            <ul>
              <li>URL: <code>{pairing.url}</code></li>
              <li>Authentication on, username <code>{pairing.username}</code>, password <code>{pairing.password}</code></li>
              <li>Monitoring mode: <strong>Significant</strong> (or Move for more updates)</li>
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
