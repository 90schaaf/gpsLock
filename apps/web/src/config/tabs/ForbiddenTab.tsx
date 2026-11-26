import { fmtMinutes, forbiddenTimings, zonesWithRole } from '@lockation/core';
import { ConsequenceEditor, NullableMinutesField, NumberField, OverrideField, WindowsEditor } from '../editors.js';
import { forbiddenTimeline } from '../helpers.js';
import { NoZonesHint, offOr, Section, zoneColor, type TabProps } from '../shared.js';

export function ForbiddenTab({ config, edit, editZone, commands, selected, setTab }: TabProps) {
  const R = config.rules;
  const T = config.tracking;
  const zones = zonesWithRole(config, 'forbidden');
  const ruleTimings = {
    firstWarning: R.forbidden.firstWarningAfterMinutes,
    firstPenalty: R.forbidden.firstPenaltyAfterMinutes,
    repeatEvery: R.forbidden.repeatEveryMinutes,
    repeatWarning: R.forbidden.repeatWarningAfterMinutes,
  };
  return (
    <Section title="Forbidden zones" enabled={R.forbidden.enabled} onToggle={(v) => edit((d) => { d.rules.forbidden.enabled = v; })}
      help="Staying inside a forbidden zone escalates: a warning, then a first penalty, then a penalty at regular intervals until the wearer has left. The timeline needs background tracking – a manual check-in inside is penalised immediately.">
      {!T.enabled && <p class="small notice" style={{ margin: 0 }}>Without background tracking only manual check-ins inside are penalised (at most once per repeat interval).</p>}
      <div class="grid2">
        <NullableMinutesField path="rules.forbidden.firstWarningAfterMinutes" label="First warning" value={R.forbidden.firstWarningAfterMinutes} fallback={2} min={0} onChange={(v) => edit((d) => { d.rules.forbidden.firstWarningAfterMinutes = v ?? null; })} />
        <NumberField label="First penalty after" suffix="minutes inside" min={0} value={R.forbidden.firstPenaltyAfterMinutes} onChange={(v) => edit((d) => { d.rules.forbidden.firstPenaltyAfterMinutes = v ?? 0; })} />
        <NumberField label="Then a penalty every" suffix="minutes, min. 5" min={5} value={R.forbidden.repeatEveryMinutes} onChange={(v) => edit((d) => { d.rules.forbidden.repeatEveryMinutes = v ?? 5; })} />
        <NullableMinutesField path="rules.forbidden.repeatWarningAfterMinutes" label="Warning after each penalty" value={R.forbidden.repeatWarningAfterMinutes} fallback={1} min={0} onChange={(v) => edit((d) => { d.rules.forbidden.repeatWarningAfterMinutes = v ?? null; })} />
      </div>
      <p class="small muted" data-testid="forbidden-timeline" style={{ margin: 0 }}>Default timeline: {forbiddenTimeline(ruleTimings)}</p>
      <ConsequenceEditor label="Penalty (all forbidden zones)" repeating="penalty" toyKeep={['leave']} value={R.forbidden.onEnter} commands={commands} onChange={(v) => edit((d) => { d.rules.forbidden.onEnter = v; })} />

      <h3>Forbidden zones</h3>
      {zones.length === 0 && <NoZonesHint role="forbidden" setTab={setTab} />}
      {zones.map((z) => {
        const t = forbiddenTimings(config, z);
        const always = z.forbidden.windows.length === 0;
        return (
          <details class="zone-details" key={z.id} open={z.id === selected} data-testid="forbidden-zone">
            <summary>
              <span class="dot" style={{ background: zoneColor(z) }} /> <strong>{z.name}</strong>{' '}
              <span class="small muted">{always ? 'always' : `during ${z.forbidden.windows.map((w) => `${w.start}–${w.end}`).join(', ')}`}</span>
            </summary>
            <div class="stack">
              <div class="row">
                <label class="check">
                  <input type="radio" name={`fw-${z.id}`} checked={always} onChange={() => editZone(z.id, (x) => { x.forbidden.windows = []; })} />
                  Always forbidden
                </label>
                <label class="check">
                  <input type="radio" name={`fw-${z.id}`} checked={!always} onChange={() => editZone(z.id, (x) => { if (!x.forbidden.windows.length) x.forbidden.windows = [{ start: '20:00', end: '02:00' }]; })} />
                  Only during
                </label>
              </div>
              {!always && <WindowsEditor value={z.forbidden.windows} onChange={(v) => editZone(z.id, (x) => { x.forbidden.windows = v; })} />}
              <div class="grid2">
                <NullableMinutesField path={`zones.${config.zones.indexOf(z)}.forbidden.firstWarningAfterMinutes`} label="First warning" value={z.forbidden.firstWarningAfterMinutes} fallback={2} min={0} inherited={{ value: R.forbidden.firstWarningAfterMinutes, format: offOr }} onChange={(v) => editZone(z.id, (x) => { x.forbidden.firstWarningAfterMinutes = v; })} />
                <OverrideField label="First penalty after" suffix="minutes" min={0} value={z.forbidden.firstPenaltyAfterMinutes} inherited={R.forbidden.firstPenaltyAfterMinutes} format={fmtMinutes} onChange={(v) => editZone(z.id, (x) => { x.forbidden.firstPenaltyAfterMinutes = v; })} />
                <OverrideField label="Then every" suffix="minutes, min. 5" min={5} value={z.forbidden.repeatEveryMinutes} inherited={R.forbidden.repeatEveryMinutes} format={fmtMinutes} onChange={(v) => editZone(z.id, (x) => { x.forbidden.repeatEveryMinutes = v; })} />
                <NullableMinutesField path={`zones.${config.zones.indexOf(z)}.forbidden.repeatWarningAfterMinutes`} label="Warning after each penalty" value={z.forbidden.repeatWarningAfterMinutes} fallback={1} min={0} inherited={{ value: R.forbidden.repeatWarningAfterMinutes, format: offOr }} onChange={(v) => editZone(z.id, (x) => { x.forbidden.repeatWarningAfterMinutes = v; })} />
              </div>
              <p class="small muted" style={{ margin: 0 }}>{z.name}: {forbiddenTimeline(t)}</p>
              <ConsequenceEditor label={`Extra punishment in ${z.name} (after the common penalty)`} repeating="penalty" toyKeep={['leave']} value={z.forbidden.onEnter} commands={commands} onChange={(v) => editZone(z.id, (x) => { x.forbidden.onEnter = v; })} />
            </div>
          </details>
        );
      })}
    </Section>
  );
}
