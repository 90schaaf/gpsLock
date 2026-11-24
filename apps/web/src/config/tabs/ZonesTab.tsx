import { MAX_RADIUS_M, MIN_RADIUS_M, SMALL_RADIUS_HINT_M, zonesWithRole, type Zone } from '@lockation/core';
import { ConsequenceEditor, NumberField } from '../editors.js';
import { applyRoles, droppedRolesWithSettings, toggleRole, type RoleChoice } from '../helpers.js';
import { PlacesInfo, ReachNote, setAck, val, zoneColor, type TabProps } from '../shared.js';

const ROLE_CHIPS: { id: RoleChoice; label: string }[] = [
  { id: 'required', label: '⏱ Required' },
  { id: 'reward', label: '🏆 Reward' },
  { id: 'forbidden', label: '⛔ Forbidden' },
  { id: 'neutral', label: 'Neutral' },
];

export function ZonesTab({ config, edit, commands, reach, selected, setSelected }: TabProps) {
  function changeRole(z: Zone, choice: RoleChoice) {
    const next = toggleRole(z.roles, choice);
    const lost = droppedRolesWithSettings(z, next);
    if (lost.length && !confirm(`Remove the ${lost.join(' and ')} settings of "${z.name}"? Its per-zone ${lost.join('/')} settings will be lost.`)) return;
    edit((d) => {
      const i = d.zones.findIndex((x) => x.id === z.id);
      if (i < 0) return;
      d.zones[i] = applyRoles(d.zones[i]!, next);
      // Marking the first zone with a role switches the matching rule on.
      for (const r of next) if (!z.roles.includes(r) && !d.rules[r].enabled && zonesWithRole(d, r).length === 1) d.rules[r].enabled = true;
    });
  }

  return (
    <div class="card">
      <h2>Zones</h2>
      <PlacesInfo config={config} />
      <ul class="plain zone-list">
        {config.zones.map((z, i) => (
          <li key={z.id} class={z.id === selected ? 'selected' : ''} onClick={() => setSelected(z.id)} data-testid="zone-item">
            <span class="dot" style={{ background: zoneColor(z) }} />
            <input value={z.name} maxLength={60} aria-label="zone name" onInput={(e) => edit((d) => { d.zones[i]!.name = val(e); })} />
            <input type="number" style={{ width: '90px' }} min={MIN_RADIUS_M} max={MAX_RADIUS_M} value={z.radiusM} aria-label="radius" onInput={(e) => edit((d) => { d.zones[i]!.radiusM = Number(val(e)); })} />
            <span class="small muted">m</span>
            <button class="link danger" aria-label="delete zone" onClick={(e) => { e.stopPropagation(); edit((d) => { d.zones.splice(i, 1); }); }}>✕</button>
            <div class="chips full" role="group" aria-label="zone role">
              {ROLE_CHIPS.map((c) => {
                const on = c.id === 'neutral' ? z.roles.length === 0 : z.roles.includes(c.id);
                return (
                  <button key={c.id} type="button" class={`chip${on ? ' active' : ''}`} aria-pressed={on} onClick={(e) => { e.stopPropagation(); changeRole(z, c.id); }}>
                    {c.label}
                  </button>
                );
              })}
              <select
                class="chip-select"
                aria-label="zone matching"
                value={z.matchMode ?? ''}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => edit((d) => { const v = (e.target as HTMLSelectElement).value; if (v) d.zones[i]!.matchMode = v as 'strict'; else delete d.zones[i]!.matchMode; })}
              >
                <option value="">Matching: default ({config.matchMode})</option>
                <option value="lenient">Matching: lenient</option>
                <option value="strict">Matching: strict</option>
              </select>
            </div>
            {(z.required.stayWindows.length > 0 && z.roles.includes('required')) || (z.forbidden.windows.length > 0 && z.roles.includes('forbidden')) ? (
              <span class="small muted full">🕑 {z.roles.includes('required') ? 'stay inside' : 'forbidden'} {(z.roles.includes('required') ? z.required.stayWindows : z.forbidden.windows).map((w) => `${w.start}–${w.end}`).join(', ')}</span>
            ) : null}
            {z.radiusM < SMALL_RADIUS_HINT_M && (
              <span class="small muted full" data-testid="small-radius-hint">
                ⚠ Small zone: phone GPS indoors is often less precise than {z.radiusM} m – check-ins may be judged "outside".
              </span>
            )}
            <ReachNote status={reach[z.id]} ack={z.reachabilityAck} onAck={(on) => setAck(edit, 'zone', z.id, reach[z.id], on)} />
            <details class="zone-details full" data-testid="zone-actions" onClick={(e) => e.stopPropagation()} open={z.actions.onEnter.length + z.actions.onLeave.length > 0 && z.id === selected}>
              <summary class="small">
                ⚡ Actions on enter / leave{z.actions.onEnter.length + z.actions.onLeave.length ? ` (${z.actions.onEnter.length + z.actions.onLeave.length})` : ''}
              </summary>
              <div class="stack">
                <p class="small muted" style={{ margin: 0 }}>
                  Independent of the role – also for neutral zones. Leaving counts once the wearer is clearly outside (with background tracking at
                  once, otherwise at the next check-in outside).
                </p>
                <ConsequenceEditor label="When entering" value={z.actions.onEnter} commands={commands} onChange={(v) => edit((d) => { d.zones[i]!.actions.onEnter = v; })} />
                <ConsequenceEditor label="When leaving" value={z.actions.onLeave} commands={commands} onChange={(v) => edit((d) => { d.zones[i]!.actions.onLeave = v; })} />
                <div class="grid2">
                  <NumberField path={`zones.${i}.actions.minStayMinutes`} label="Leaving counts only after at least" suffix="minutes inside" min={0} value={z.actions.minStayMinutes} hint="E.g. 45 min at the gym before 'unfreeze'." onChange={(v) => edit((d) => { d.zones[i]!.actions.minStayMinutes = v ?? 0; })} />
                  <NumberField path={`zones.${i}.actions.cooldownMinutes`} label="Cooldown" suffix="minutes" min={0} value={z.actions.cooldownMinutes} hint="Minimum time between two runs of the same action." onChange={(v) => edit((d) => { d.zones[i]!.actions.cooldownMinutes = v ?? 0; })} />
                </div>
              </div>
            </details>
          </li>
        ))}
      </ul>
      {config.zones.length === 0 && <p class="muted">No zones yet – tap the map or search an address.</p>}
      <p class="small muted">
        Roles: <strong>Required</strong> and/or <strong>Reward</strong>, or <strong>Forbidden</strong>, or <strong>Neutral</strong> (no rule – for orientation or zone actions). The rule tabs list the zones of their role. Every zone can also run <strong>actions on enter / leave</strong>.
      </p>
      <div class="grid2" style={{ marginTop: '10px' }}>
        <label class="field">
          Zone matching (default)
          <select value={config.matchMode} onChange={(e) => edit((d) => { d.matchMode = (e.target as HTMLSelectElement).value as 'lenient' | 'strict'; })}>
            <option value="lenient">Lenient – position inside zone</option>
            <option value="strict">Strict – whole accuracy circle inside</option>
          </select>
        </label>
        <label class="field">
          Timezone (for time windows, quiet hours & daily limits)
          <input value={config.timezone} onInput={(e) => edit((d) => { d.timezone = val(e); })} />
        </label>
      </div>
    </div>
  );
}
