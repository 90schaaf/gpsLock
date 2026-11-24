import { fmtMinutes, minRequiredInterval, zonesWithRole } from '@lockation/core';
import { ConsequenceEditor, NumberField, OverrideField, TimeRange, WindowsEditor } from '../editors.js';
import { checked, NoZonesHint, Section, zoneColor, type TabProps } from '../shared.js';

export function RequiredTab({ config, edit, editZone, commands, selected, setTab }: TabProps) {
  const R = config.rules;
  const T = config.tracking;
  const zones = zonesWithRole(config, 'required');
  const stayWindowsUsed = zones.some((z) => z.required.stayWindows.length > 0);
  return (
    <Section title="Required zones" enabled={R.required.enabled} onToggle={(v) => edit((d) => { d.rules.required.enabled = v; })}
      help={'The wearer must check in regularly inside each required zone (and/or anywhere). Required zones can also have "must stay inside" time windows.'}>
      <div class="grid2">
        <label class="check" style={{ alignItems: 'flex-start' }}>
          <input type="checkbox" checked={R.required.anywhere} onChange={(e) => edit((d) => { d.rules.required.anywhere = checked(e); })} />
          <span>
            Also require a check-in anywhere (proves the position)
            <span class="small muted" style={{ display: 'block' }}>
              An extra deadline that doesn't depend on a zone: the wearer must check in somewhere at least once per interval, so their
              position is known regularly (useful with forbidden zones). With background tracking every location counts.
            </span>
          </span>
        </label>
        <NumberField path="rules.required.intervalMinutes" label="Interval (default)" suffix="minutes" min={minRequiredInterval(config)} value={R.required.intervalMinutes} hint={`${fmtMinutes(R.required.intervalMinutes)} · minimum ${minRequiredInterval(config)} min (${minRequiredInterval(config) === 3 ? 'background tracking' : 'manual check-ins; 3 min with background tracking'})`} onChange={(v) => edit((d) => { d.rules.required.intervalMinutes = v ?? 240; })} />
        <NumberField label="Grace period (default)" suffix="minutes" min={0} value={R.required.graceMinutes} onChange={(v) => edit((d) => { d.rules.required.graceMinutes = v ?? 0; })} />
        <NumberField path="rules.required.warnBeforeMinutes" label="Warn before a deadline" suffix="minutes, empty = off" optional min={5} value={R.required.warnBeforeMinutes} hint="Sent to the wearer's notifications (ntfy) if set up." onChange={(v) => edit((d) => { d.rules.required.warnBeforeMinutes = v; })} />
        <TimeRange label="Quiet hours (no deadline inside)" value={R.required.quietHours} onChange={(v) => edit((d) => { d.rules.required.quietHours = v; })} />
      </div>
      <ConsequenceEditor label="When a check-in is missed (all zones)" repeating="miss" value={R.required.onMissed} commands={commands} onChange={(v) => edit((d) => { d.rules.required.onMissed = v; })} />
      <ConsequenceEditor label="When checking in outside the required zones" value={R.required.onOutside} commands={commands} onChange={(v) => edit((d) => { d.rules.required.onOutside = v; })} />
      <ConsequenceEditor label="On every successful check-in (all zones)" value={R.required.onSuccess} commands={commands} onChange={(v) => edit((d) => { d.rules.required.onSuccess = v; })} />

      <h3>Required zones</h3>
      {zones.length === 0 && <NoZonesHint role="required" setTab={setTab} />}
      {zones.map((z) => (
        <details class="zone-details" key={z.id} open={z.id === selected} data-testid="required-zone">
          <summary>
            <span class="dot" style={{ background: zoneColor(z) }} /> <strong>{z.name}</strong>{' '}
            <span class="small muted">
              {z.required.intervalCheckins ? `every ${fmtMinutes(z.required.intervalMinutes ?? R.required.intervalMinutes)}` : 'no interval check-ins'}
              {z.required.stayWindows.length > 0 && ` · stay inside ${z.required.stayWindows.map((w) => `${w.start}–${w.end}`).join(', ')}`}
            </span>
          </summary>
          <div class="stack">
            <label class="check">
              <input type="checkbox" checked={z.required.intervalCheckins} onChange={(e) => editZone(z.id, (x) => { x.required.intervalCheckins = checked(e); })} />
              Interval check-ins in this zone
            </label>
            {z.required.intervalCheckins && (
              <div class="grid2">
                <OverrideField path={`zones.${config.zones.indexOf(z)}.required.intervalMinutes`} label="Interval" suffix="minutes" min={minRequiredInterval(config)} value={z.required.intervalMinutes} inherited={R.required.intervalMinutes} format={fmtMinutes} onChange={(v) => editZone(z.id, (x) => { x.required.intervalMinutes = v; })} />
                <OverrideField label="Grace period" suffix="minutes" min={0} value={z.required.graceMinutes} inherited={R.required.graceMinutes} format={fmtMinutes} onChange={(v) => editZone(z.id, (x) => { x.required.graceMinutes = v; })} />
              </div>
            )}
            <div class="small"><strong>Must stay inside during</strong> <span class="muted">(e.g. 22:00–06:00 = stay home at night)</span></div>
            <WindowsEditor value={z.required.stayWindows} addLabel="Add stay-inside window" onChange={(v) => editZone(z.id, (x) => { x.required.stayWindows = v; })} />
            {z.required.stayWindows.length > 0 && !T.enabled && (
              <div class="notice small" data-testid="needs-tracking">
                Stay-inside windows need background tracking (the wearer's phone reports the location with OwnTracks).{' '}
                <button onClick={() => edit((d) => { d.tracking.enabled = true; })}>Enable background tracking</button>
              </div>
            )}
            <ConsequenceEditor label={`Extra when the check-in in ${z.name} is missed`} repeating="miss" value={z.required.onMissed} commands={commands} onChange={(v) => editZone(z.id, (x) => { x.required.onMissed = v; })} />
            <ConsequenceEditor label={`Extra on a successful check-in in ${z.name}`} value={z.required.onSuccess} commands={commands} onChange={(v) => editZone(z.id, (x) => { x.required.onSuccess = v; })} />
            {z.required.stayWindows.length > 0 && (
              <ConsequenceEditor label={`Extra when outside ${z.name} during a stay window`} value={z.required.onOutsideDuringWindow} commands={commands} onChange={(v) => editZone(z.id, (x) => { x.required.onOutsideDuringWindow = v; })} />
            )}
          </div>
        </details>
      ))}
      {stayWindowsUsed && (
        <>
          <h3>Stay-inside windows (all zones)</h3>
          <NumberField label="At most once every" suffix="minutes" min={0} value={R.required.windowCooldownMinutes} onChange={(v) => edit((d) => { d.rules.required.windowCooldownMinutes = v ?? 60; })} />
          <ConsequenceEditor label="When outside during a stay window" value={R.required.onOutsideDuringWindow} commands={commands} onChange={(v) => edit((d) => { d.rules.required.onOutsideDuringWindow = v; })} />
        </>
      )}
    </Section>
  );
}
