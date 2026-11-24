import { ConsequenceEditor, NumberField } from '../editors.js';
import { Section, type TabProps } from '../shared.js';

const km = (n: number) => `${Math.round(n * 100) / 100} km`;
const rewards = (n: number) => `${n} reward${n === 1 ? '' : 's'}`;

/** Worked example for the travel tab, built from the current settings. */
export function travelExample(stepKm: number, maxKmPerCheckin: number): string {
  if (!(stepKm > 0) || !(maxKmPerCheckin > 0)) return '';
  const moved = stepKm * 2.5;
  const counted = Math.min(moved, maxKmPerCheckin);
  const steps = Math.floor(counted / stepKm + 1e-9);
  const rest = counted - steps * stepKm;
  const first =
    `Example: moving ${km(moved)} between two check-ins counts ${km(counted)} → ${rewards(steps)}` +
    (rest > 1e-9 ? `, ${km(rest)} carried over.` : '.');
  const jump = Math.max(40, Math.ceil(maxKmPerCheckin * 4));
  const second = ` A ${km(jump)} train ride counts only ${km(maxKmPerCheckin)} → ${rewards(Math.floor(maxKmPerCheckin / stepKm + 1e-9))}.`;
  return first + second;
}

export function TravelTab({ config, edit, commands }: TabProps) {
  const R = config.rules;
  return (
    <Section title="Travel goals" enabled={R.travel.enabled} onToggle={(v) => edit((d) => { d.rules.travel.enabled = v; })}
      help="The straight-line distance between consecutive check-ins (or background updates) counts. Time consequences are multiplied by the number of completed steps.">
      <div class="grid2">
        <NumberField label="Step size – distance per reward" suffix="km" min={0.1} step={0.1} value={R.travel.stepKm} onChange={(v) => edit((d) => { d.rules.travel.stepKm = v ?? 1; })}
          hint="Every full step runs the consequences below once. Leftover distance carries over." />
        <NumberField label="Max per check-in – limit for one jump" suffix="km" min={0.1} step={0.1} value={R.travel.maxKmPerCheckin} onChange={(v) => edit((d) => { d.rules.travel.maxKmPerCheckin = v ?? 50; })}
          hint="A single check-in never adds more than this, e.g. after a train ride." />
        <NumberField label="Daily cap – limit per day" suffix="km" min={0.1} step={0.1} value={R.travel.dailyCapKm} onChange={(v) => edit((d) => { d.rules.travel.dailyCapKm = v ?? 100; })}
          hint="Distance beyond this per day (lock timezone) counts for nothing." />
      </div>
      <p class="small muted" data-testid="travel-example" style={{ margin: 0 }}>{travelExample(R.travel.stepKm, R.travel.maxKmPerCheckin)}</p>
      <ConsequenceEditor label="For every step" value={R.travel.onStep} commands={commands} onChange={(v) => edit((d) => { d.rules.travel.onStep = v; })} />
    </Section>
  );
}
