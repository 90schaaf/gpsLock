import type { SessionView, ZoneView } from '@lockation/core';
import { useState } from 'preact/hooks';
import { ZONE_COLORS, type MapCircle } from '../components/LeafletMap.js';
import type { Backend } from '../lib/backend.js';
import { clockTime, formatCountdown, useNow } from '../lib/time-ui.js';

/**
 * F26 – map circle of a surprise zone. Not visited yet: pink with 🎁. Visited (can draw again): pink, dashed, 🎁✓.
 * Used up (once): grey, dashed, ✓. Holding the wearer right now: highlighted with ⏳.
 */
export function surpriseCircle(z: ZoneView): MapCircle {
  const s = z.surprise!;
  const base = { id: z.id, lat: z.lat, lng: z.lng, radiusM: z.radiusM, permanentLabel: true };
  switch (s.status) {
    case 'holding':
      return { ...base, color: ZONE_COLORS.surprise, selected: true, label: `⏳ ${z.name}` };
    case 'used':
      return { ...base, color: ZONE_COLORS.last, dashed: true, label: `✓ ${z.name}` };
    case 'visited':
      return { ...base, color: ZONE_COLORS.surprise, dashed: true, label: `🎁✓ ${z.name}` };
    default:
      return { ...base, color: ZONE_COLORS.surprise, label: `🎁 ${z.name}` };
  }
}

type Hold = NonNullable<SessionView['surpriseHolds']>[number];

/** The wearer is held in a surprise zone: countdown, and for the keyholder an early release. */
export function SurpriseHoldCard({ hold, view, backend, onView, onError }: { hold: Hold; view: SessionView; backend: Backend; onView: (v: SessionView) => void; onError: (m: string) => void }) {
  const now = useNow();
  const [busy, setBusy] = useState(false);
  const left = Date.parse(hold.until) - now;
  return (
    <div class="card mission-active" data-testid="surprise-hold">
      <h2>
        🎁 {hold.label} <span class="badge warn">{left > 0 ? formatCountdown(left) : 'releasing…'}</span>
      </h2>
      <p style={{ margin: 0 }}>
        {hold.mode === 'stay' ? (
          <>
            {view.role === 'wearer' ? 'Stay' : 'The wearer must stay'} in <strong>{hold.zoneName}</strong> until <strong>{clockTime(hold.until, view.timezone, now)}</strong>.
          </>
        ) : (
          <>
            {view.role === 'wearer' ? 'Stay' : 'The wearer waits'} in <strong>{hold.zoneName}</strong> until the keyholder releases {view.role === 'wearer' ? 'you' : 'them'} – at the latest{' '}
            <strong>{clockTime(hold.until, view.timezone, now)}</strong>.
          </>
        )}
      </p>
      {view.role === 'wearer' && <p class="small muted" style={{ margin: 0 }}>Leaving before being released has consequences.</p>}
      {hold.canRelease && (
        <div class="row">
          <button
            class="primary"
            disabled={busy}
            data-testid="surprise-release"
            onClick={async () => {
              setBusy(true);
              try {
                onView(await backend.surpriseAction({ type: 'release', zoneId: hold.zoneId }));
              } catch (e) {
                onError(e instanceof Error ? e.message : String(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            🔓 Release now
          </button>
        </div>
      )}
    </div>
  );
}
