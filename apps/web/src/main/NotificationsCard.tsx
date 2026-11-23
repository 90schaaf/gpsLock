/** ntfy push notifications: wearer warnings and keyholder events. */
import type { SessionView } from '@lockation/core';
import { useMemo, useState } from 'preact/hooks';
import { ApiError, type Backend, type NotificationSetup } from '../lib/backend.js';
import { qrSvg } from './TrackingCard.js';

export const NTFY_IOS = 'https://apps.apple.com/app/ntfy/id1625396347';
export const NTFY_ANDROID = 'https://play.google.com/store/apps/details?id=io.heckel.ntfy';

export function NotificationsCard({ view, backend, onView, onError }: { view: SessionView; backend: Backend; onView: (v: SessionView) => void; onError: (msg: string) => void }) {
  const [setup, setSetup] = useState<NotificationSetup>();
  const [busy, setBusy] = useState(false);
  const svg = useMemo(() => (setup ? qrSvg(setup.url) : ''), [setup]);
  const n = view.notifications;
  // Self-locks: wearer and keyholder are the same person – only the wearer setup is offered.
  if (!n?.available || (view.isSelfLock && view.role === 'keyholder')) return null;
  const isWearer = view.role === 'wearer';

  async function start() {
    if (n?.subscribed && !confirm('Create a new notification topic? The old subscription stops receiving messages.')) return;
    setBusy(true);
    try {
      const s = await backend.setupNotifications();
      setSetup(s);
      onView(s.view);
    } catch (e) {
      onError(e instanceof ApiError && e.code === 'notifications_unavailable' ? 'Notifications are not available on this server.' : e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function stop() {
    if (!confirm(isWearer ? 'Stop notifications? You will no longer be warned before penalties.' : 'Stop notifications about this lock?')) return;
    setBusy(true);
    try {
      onView(await backend.stopNotifications());
      setSetup(undefined);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div class="card stack" data-testid="notifications-card">
      <h2>
        🔔 Notifications <span class={`badge ${n.subscribed ? 'ok' : ''}`}>{n.subscribed ? 'set up' : 'off'}</span>
      </h2>
      <p class="small muted" style={{ margin: 0 }}>
        {isWearer
          ? 'Get a push warning before a penalty (forbidden zone, missing signal, due check-in) and when the keyholder changes the rules.'
          : 'Get a push message when the wearer is penalised, enters a forbidden zone, misses a check-in and more (choose in the configuration).'}{' '}
        No coordinates are ever sent.
      </p>
      {!setup && (
        <div class="row">
          <button class={n.subscribed ? '' : 'primary'} disabled={busy} onClick={start} data-testid="notify-setup">
            {n.subscribed ? '🔁 Set up again' : '🔔 Set up notifications'}
          </button>
          {n.subscribed && (
            <button class="danger" disabled={busy} onClick={stop} data-testid="notify-stop">
              Stop notifications
            </button>
          )}
        </div>
      )}
      {setup && (
        <div class="stack">
          <ol class="small" style={{ margin: 0, paddingLeft: '18px' }}>
            <li>
              Install the free <strong>ntfy</strong> app: <a href={NTFY_IOS} target="_blank" rel="noopener">iPhone</a> ·{' '}
              <a href={NTFY_ANDROID} target="_blank" rel="noopener">Android</a>
            </li>
            <li>Tap <em>Open in ntfy</em> below (or scan the code), then subscribe and allow notifications.</li>
            <li>
              Manually: in ntfy tap <em>+</em>, server <code>ntfy.sh</code>, topic <code data-testid="notify-topic">{setup.topic}</code>.
            </li>
          </ol>
          <a class="btn primary" href={setup.deepLink} style={{ justifyContent: 'center' }}>
            📲 Open in ntfy
          </a>
          <div style={{ maxWidth: '220px', background: '#fff', padding: '6px', borderRadius: '8px' }} dangerouslySetInnerHTML={{ __html: svg }} />
          <p class="small muted" style={{ margin: 0 }}>
            Web: <a href={setup.url} target="_blank" rel="noopener">{setup.url}</a>. Keep the topic secret – anyone who knows it can read the messages.
          </p>
          <button class="link" onClick={() => setSetup(undefined)}>Done</button>
        </div>
      )}
    </div>
  );
}
