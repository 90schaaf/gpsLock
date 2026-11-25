import { fmtMinutes, missionTargets } from '@lockation/core';
import { ConsequenceEditor, NumberField } from '../editors.js';
import { checked, Section, type TabProps } from '../shared.js';

/** F25 – surprise missions: "be at zone X within N minutes" (never a forbidden zone). */
export function MissionsTab({ config, edit, commands, setTab }: TabProps) {
  const M = config.rules.mission;
  const eligible = config.zones.filter((z) => !z.roles.includes('forbidden') && !z.hidden);
  const targets = missionTargets(config);
  const toggleZone = (id: string, on: boolean) =>
    edit((d) => {
      const all = d.zones.filter((z) => !z.roles.includes('forbidden') && !z.hidden).map((z) => z.id);
      const cur = new Set(d.rules.mission.zoneIds.length ? d.rules.mission.zoneIds : all);
      if (on) cur.add(id);
      else cur.delete(id);
      // Every eligible zone selected = "all" (also includes zones added later).
      d.rules.mission.zoneIds = all.every((x) => cur.has(x)) ? [] : all.filter((x) => cur.has(x));
    });
  return (
    <Section
      title="Surprise missions"
      enabled={M.enabled}
      onToggle={(v) => edit((d) => { d.rules.mission.enabled = v; })}
      help='"Be at the café by 14:30!" – at a random time (or sent by the keyholder) the wearer has to reach one of the zones below in time. Forbidden and hidden zones are never mission targets.'
    >
      <h3>Target zones</h3>
      {eligible.length === 0 ? (
        <p class="small muted">
          No zone can be a target yet – missions only go to zones that are neither forbidden nor hidden.{' '}
          <button class="link" onClick={() => setTab('zones')}>Add a zone</button>
        </p>
      ) : (
        <div class="stack" data-testid="mission-zones">
          {eligible.map((z) => (
            <label class="check" key={z.id}>
              <input type="checkbox" checked={targets.some((t) => t.id === z.id)} onChange={(e) => toggleZone(z.id, checked(e))} />
              {z.name}
            </label>
          ))}
          <span class="small muted">
            {M.zoneIds.length ? `${targets.length} of ${eligible.length} zones.` : 'All zones that are not forbidden (also zones added later).'} Random missions skip the zone the wearer is in and zones closer than the minimum distance.
          </span>
        </div>
      )}
      <div class="grid2">
        <NumberField path="rules.mission.leadMinutes" label="Time to get there" suffix="minutes" min={5} max={720} value={M.leadMinutes} onChange={(v) => edit((d) => { d.rules.mission.leadMinutes = v ?? 45; })} />
        <NumberField path="rules.mission.warnBeforeMinutes" label="Reminder before the end" suffix="minutes, 0 = none" min={0} max={120} value={M.warnBeforeMinutes} onChange={(v) => edit((d) => { d.rules.mission.warnBeforeMinutes = v ?? 0; })} />
        <NumberField path="rules.mission.declinesPerDay" label="Declines per day without penalty" suffix="0 = never" min={0} max={10} value={M.declinesPerDay} hint={`"Can't right now" – the keyholder is told.`} onChange={(v) => edit((d) => { d.rules.mission.declinesPerDay = v ?? 0; })} />
      </div>
      <div class="card stack" style={{ padding: '10px 12px' }}>
        <label class="check">
          <input type="checkbox" checked={M.random.enabled} onChange={(e) => edit((d) => { d.rules.mission.random.enabled = checked(e); })} />
          <span><strong>Random missions</strong> – Lockation sends missions by itself, at unpredictable times. Works on self-locks too.</span>
        </label>
        {M.random.enabled && (
          <div class="grid2">
            <NumberField path="rules.mission.random.everyMinutes" label="On average every" suffix="minutes (±50 %)" min={5} max={10080} value={M.random.everyMinutes} hint={`≈ ${fmtMinutes(M.random.everyMinutes)}, randomly between ${fmtMinutes(Math.round(M.random.everyMinutes / 2))} and ${fmtMinutes(Math.round(M.random.everyMinutes * 1.5))}.`} onChange={(v) => edit((d) => { d.rules.mission.random.everyMinutes = v ?? 240; })} />
            <NumberField path="rules.mission.minDistanceM" label="Minimum distance" suffix="m from the wearer" min={0} value={M.minDistanceM} onChange={(v) => edit((d) => { d.rules.mission.minDistanceM = v ?? 0; })} />
            <label class="field">
              {`Only from (lock time zone: ${config.timezone})`}
              <input type="time" value={M.random.activeHours.start} data-testid="mission-from" onInput={(e) => { const v = (e.target as HTMLInputElement).value; if (v) edit((d) => { d.rules.mission.random.activeHours.start = v; }); }} />
            </label>
            <label class="field">
              Until
              <input type="time" value={M.random.activeHours.end} onInput={(e) => { const v = (e.target as HTMLInputElement).value; if (v) edit((d) => { d.rules.mission.random.activeHours.end = v; }); }} />
            </label>
          </div>
        )}
        {M.random.enabled && <span class="small muted">No random missions outside these hours. Same start and end = all day.</span>}
        <label class="check">
          <input type="checkbox" checked={M.keyholderCanSend} onChange={(e) => edit((d) => { d.rules.mission.keyholderCanSend = checked(e); })} />
          The keyholder can send a mission by hand (choose zone and time)
        </label>
      </div>
      <ConsequenceEditor label="Arrived in time" value={M.onSuccess} commands={commands} onChange={(v) => edit((d) => { d.rules.mission.onSuccess = v; })} />
      <ConsequenceEditor label="Too late" value={M.onFail} commands={commands} onChange={(v) => edit((d) => { d.rules.mission.onFail = v; })} />
      <p class="small muted" style={{ margin: 0 }}>
        Arrival counts by check-in or background location. With background tracking a location taken in time counts even if it arrives up to 5 minutes late.
      </p>
    </Section>
  );
}
