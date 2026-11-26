import { fmtMinutes, zonesWithRole } from '@lockation/core';
import { ZONE_COLORS } from '../../components/LeafletMap.js';
import { ConsequenceEditor, NumberField, OverrideField } from '../editors.js';
import { NoZonesHint, Section, type TabProps } from '../shared.js';

export function RewardTab({ config, edit, editZone, commands, selected, setTab }: TabProps) {
  const R = config.rules;
  const zones = zonesWithRole(config, 'reward');
  return (
    <Section title="Reward zones" enabled={R.reward.enabled} onToggle={(v) => edit((d) => { d.rules.reward.enabled = v; })} help="Checking in at a goal location (gym, work, …) gives a reward.">
      <div class="grid2">
        <NumberField label="Cooldown per zone (default)" suffix="minutes" min={0} value={R.reward.cooldownMinutes} onChange={(v) => edit((d) => { d.rules.reward.cooldownMinutes = v ?? 0; })} />
        <NumberField label="Max rewards per day – all zones" min={1} value={R.reward.maxPerDay} onChange={(v) => edit((d) => { d.rules.reward.maxPerDay = v ?? 1; })} />
        <NumberField label="Minimum stay (default)" suffix="minutes, 0 = immediately" min={0} value={R.reward.dwellMinutes} onChange={(v) => edit((d) => { d.rules.reward.dwellMinutes = v ?? 0; })} />
      </div>
      <ConsequenceEditor label="Reward (all reward zones)" toyKeep={['leave']} value={R.reward.onEnter} commands={commands} onChange={(v) => edit((d) => { d.rules.reward.onEnter = v; })} />
      <h3>Reward zones</h3>
      {zones.length === 0 && <NoZonesHint role="reward" setTab={setTab} />}
      {zones.map((z) => (
        <details class="zone-details" key={z.id} open={z.id === selected} data-testid="reward-zone">
          <summary>
            <span class="dot" style={{ background: ZONE_COLORS.reward }} /> <strong>{z.name}</strong>{' '}
            <span class="small muted">max {z.reward.maxPerDay ?? R.reward.maxPerDay}× per day</span>
          </summary>
          <div class="stack">
            <div class="grid2">
              <OverrideField label="Cooldown" suffix="minutes" min={0} value={z.reward.cooldownMinutes} inherited={R.reward.cooldownMinutes} format={fmtMinutes} onChange={(v) => editZone(z.id, (x) => { x.reward.cooldownMinutes = v; })} />
              <OverrideField label="Max per day" min={1} value={z.reward.maxPerDay} inherited={R.reward.maxPerDay} onChange={(v) => editZone(z.id, (x) => { x.reward.maxPerDay = v; })} />
              <OverrideField label="Minimum stay" suffix="minutes" min={0} value={z.reward.dwellMinutes} inherited={R.reward.dwellMinutes} format={fmtMinutes} onChange={(v) => editZone(z.id, (x) => { x.reward.dwellMinutes = v; })} />
            </div>
            <ConsequenceEditor label={`Extra reward in ${z.name}`} toyKeep={['leave']} value={z.reward.onEnter} commands={commands} onChange={(v) => editZone(z.id, (x) => { x.reward.onEnter = v; })} />
          </div>
        </details>
      ))}
    </Section>
  );
}
