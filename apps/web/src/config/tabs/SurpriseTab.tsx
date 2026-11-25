import { zonesWithRole, type SurpriseOutcome } from '@lockation/core';
import { ZONE_COLORS } from '../../components/LeafletMap.js';
import { ConsequenceEditor, NumberField } from '../editors.js';
import { checked, newId, NoZonesHint, Section, val, type TabProps } from '../shared.js';

/** Starting points for new outcomes – the keyholder can change everything afterwards. */
const PRESETS: { label: string; make: () => SurpriseOutcome }[] = [
  { label: '🏆 Reward', make: () => ({ id: newId('o'), label: 'Treasure!', weight: 1, onEnter: [{ type: 'remove_time', seconds: 1800 }], hold: 'none', onReleased: [], onEarlyLeave: [] }) },
  { label: '⏳ Stay inside', make: () => ({ id: newId('o'), label: 'Trap – stay 15 minutes', weight: 1, onEnter: [], hold: 'stay', holdMinutes: 15, onReleased: [], onEarlyLeave: [{ type: 'add_time', seconds: 3600 }] }) },
  { label: '🔑 Wait for the keyholder', make: () => ({ id: newId('o'), label: 'Wait here until you are released', weight: 1, onEnter: [], hold: 'keyholder', holdMinutes: 60, onReleased: [], onEarlyLeave: [{ type: 'add_time', seconds: 3600 }] }) },
  { label: '⛔ Punishment', make: () => ({ id: newId('o'), label: 'Bad luck!', weight: 1, onEnter: [{ type: 'add_time', seconds: 1800 }], hold: 'none', onReleased: [], onEarlyLeave: [] }) },
];

/** F26 – surprise zones: visible zones whose outcome (reward, punishment, hold) is drawn when the wearer enters. */
export function SurpriseTab({ config, edit, editZone, commands, selected, setTab }: TabProps) {
  const R = config.rules.surprise;
  const zones = zonesWithRole(config, 'surprise');
  const total = (os: SurpriseOutcome[]) => os.reduce((a, o) => a + o.weight, 0);
  return (
    <Section
      title="Surprise zones"
      enabled={R.enabled}
      onToggle={(v) => edit((d) => { d.rules.surprise.enabled = v; })}
      help="The wearer sees surprise zones on the map, but not what happens inside: on entering, one of the possible outcomes is drawn – a reward, a punishment, or having to stay inside until released."
    >
      <label class="check">
        <input type="checkbox" checked={R.showPossible} onChange={(e) => edit((d) => { d.rules.surprise.showPossible = checked(e); })} />
        Show the wearer the possible outcomes of each zone (not which one comes)
      </label>
      <h3>Surprise zones</h3>
      {zones.length === 0 && <NoZonesHint role="surprise" setTab={setTab} />}
      {zones.map((z) => {
        const zi = config.zones.findIndex((x) => x.id === z.id);
        const S = z.surprise;
        const setOutcome = (j: number, fn: (o: SurpriseOutcome) => void) => editZone(z.id, (x) => fn(x.surprise.outcomes[j]!));
        return (
          <details class="zone-details" key={z.id} open={z.id === selected || S.outcomes.length === 0} data-testid="surprise-zone">
            <summary>
              <span class="dot" style={{ background: ZONE_COLORS.surprise }} /> <strong>{z.name}</strong>{' '}
              <span class="small muted">
                {S.outcomes.length} possible {S.outcomes.length === 1 ? 'outcome' : 'outcomes'} · {S.visits === 'once' ? 'once' : 'every visit'}
              </span>
            </summary>
            <div class="stack">
              <div class="grid2">
                <label class="field">
                  Visits
                  <select value={S.visits} onChange={(e) => editZone(z.id, (x) => { x.surprise.visits = (e.target as HTMLSelectElement).value as 'once'; })}>
                    <option value="once">Only the first visit counts</option>
                    <option value="repeat">Every visit draws again</option>
                  </select>
                </label>
                {S.visits === 'repeat' && (
                  <NumberField label="At most every" suffix="minutes" min={0} value={S.cooldownMinutes} onChange={(v) => editZone(z.id, (x) => { x.surprise.cooldownMinutes = v ?? 0; })} />
                )}
              </div>
              {S.outcomes.map((o, j) => (
                <div class="card stack" key={o.id} style={{ padding: '10px 12px' }} data-testid="surprise-outcome">
                  <div class="row">
                    <input class="grow" value={o.label} maxLength={80} aria-label="outcome text" placeholder="Shown to the wearer, e.g. Treasure!" onInput={(e) => setOutcome(j, (x) => { x.label = val(e); })} />
                    <span class="small muted">chance {Math.round((o.weight / Math.max(1, total(S.outcomes))) * 100)} %</span>
                    <button class="link danger" aria-label="delete outcome" onClick={() => editZone(z.id, (x) => { x.surprise.outcomes.splice(j, 1); })}>✕</button>
                  </div>
                  <div class="grid2">
                    <NumberField label="Weight" hint="Higher = more likely" min={1} max={100} value={o.weight} onChange={(v) => setOutcome(j, (x) => { x.weight = v ?? 1; })} />
                    <label class="field">
                      Hold the wearer inside
                      <select
                        value={o.hold}
                        onChange={(e) =>
                          setOutcome(j, (x) => {
                            x.hold = (e.target as HTMLSelectElement).value as 'none';
                            if (x.hold !== 'none' && !x.holdMinutes) x.holdMinutes = x.hold === 'stay' ? 15 : 60;
                          })
                        }
                      >
                        <option value="none">No – free to go</option>
                        <option value="stay">Stay inside for a while</option>
                        <option value="keyholder">Until the keyholder releases (e.g. after a task)</option>
                      </select>
                    </label>
                    {o.hold !== 'none' && (
                      <NumberField
                        path={`zones.${zi}.surprise.outcomes.${j}.holdMinutes`}
                        label={o.hold === 'stay' ? 'Stay for' : 'Released at the latest after'}
                        suffix="minutes"
                        min={1}
                        max={1440}
                        value={o.holdMinutes}
                        hint={o.hold === 'keyholder' ? 'Needed so nobody gets stuck (e.g. on self-locks).' : undefined}
                        onChange={(v) => setOutcome(j, (x) => { x.holdMinutes = v; })}
                      />
                    )}
                  </div>
                  <ConsequenceEditor label="When entering" value={o.onEnter} commands={commands} onChange={(v) => setOutcome(j, (x) => { x.onEnter = v; })} />
                  {o.hold !== 'none' && (
                    <>
                      <ConsequenceEditor label="When released" value={o.onReleased} commands={commands} onChange={(v) => setOutcome(j, (x) => { x.onReleased = v; })} />
                      <ConsequenceEditor label="Leaving before being released" value={o.onEarlyLeave} commands={commands} onChange={(v) => setOutcome(j, (x) => { x.onEarlyLeave = v; })} />
                    </>
                  )}
                </div>
              ))}
              <div class="row" data-testid="surprise-add">
                <span class="small muted">Add outcome:</span>
                {PRESETS.map((p) => (
                  <button key={p.label} onClick={() => editZone(z.id, (x) => { x.surprise.outcomes.push(p.make()); })} disabled={S.outcomes.length >= 10}>
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          </details>
        );
      })}
      <p class="small muted" style={{ margin: 0 }}>
        On entering, one outcome is drawn by its weight. While the wearer is held, leaving is detected by the next location (check-in or background update). The
        keyholder can release early from the main page.
      </p>
    </Section>
  );
}
