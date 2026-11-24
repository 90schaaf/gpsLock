import type { TabProps } from '../shared.js';

export function PrivacyTab({ config, edit, running }: TabProps) {
  return (
    <div class="card stack">
      <h2>Privacy</h2>
      <label class="check">
        <input type="radio" name="priv" checked={config.privacy.coordinates === 'zone_only'} onChange={() => edit((d) => { d.privacy.coordinates = 'zone_only'; })} />
        Zones only – store which zones the wearer was in, never coordinates (recommended)
      </label>
      <label class="check">
        <input type="radio" name="priv" checked={config.privacy.coordinates === 'exact'} disabled={running && config.privacy.coordinates !== 'exact'} onChange={() => edit((d) => { d.privacy.coordinates = 'exact'; })} />
        Exact – the keyholder can see each check-in on a map
      </label>
      <p class="small muted">
        The wearer sees this setting before accepting the lock and can switch to "zones only" at any time. Exact sharing cannot be enabled while the lock is running. All location history is deleted when the lock ends.
      </p>
      <p class="small muted">
        Safety check: the coordinates of your zones and checkpoints (never the wearer's location) are looked up in OpenStreetMap (Overpass, Nominatim) to warn about places that are hard to reach.
      </p>
    </div>
  );
}
