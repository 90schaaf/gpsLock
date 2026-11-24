import { ConsequenceEditor, NumberField } from '../editors.js';
import type { TabProps } from '../shared.js';
import { checkinMode } from './TrackingTab.js';

export function AntiCheatTab({ config, edit, commands }: TabProps) {
  const T = config.tracking;
  return (
    <div class="card stack">
      <h2>Anti-cheat</h2>
      <p class="small muted">Browser GPS can be faked. These checks make cheating harder but Lockation remains a trust-assisted game.</p>
      <div class="grid2">
        <NumberField label="Required accuracy" suffix="m" min={10} max={500} value={config.antiCheat.maxAccuracyM} onChange={(v) => edit((d) => { d.antiCheat.maxAccuracyM = v ?? 100; })} />
        <NumberField label="Max position age" suffix="seconds" min={10} value={config.antiCheat.maxFixAgeSeconds} onChange={(v) => edit((d) => { d.antiCheat.maxFixAgeSeconds = v ?? 120; })} />
        <NumberField label="Max plausible speed" suffix="km/h" min={5} value={config.antiCheat.maxSpeedKmh} onChange={(v) => edit((d) => { d.antiCheat.maxSpeedKmh = v ?? 200; })} />
        <NumberField label="Min time between check-ins" suffix="seconds" min={0} value={config.antiCheat.minIntervalSeconds} onChange={(v) => edit((d) => { d.antiCheat.minIntervalSeconds = v ?? 60; })} />
        <label class="field">
          Implausible speed
          <select value={config.antiCheat.onImplausible} onChange={(e) => edit((d) => { d.antiCheat.onImplausible = (e.target as HTMLSelectElement).value as 'reject'; })}>
            <option value="reject">Reject the check-in</option>
            <option value="reject_and_penalize">Reject and penalise</option>
            <option value="accept_and_verify">Accept but request a verification picture</option>
          </select>
        </label>
        <label class="field">
          Verification picture
          <select value={config.antiCheat.verificationPicture} onChange={(e) => edit((d) => { d.antiCheat.verificationPicture = (e.target as HTMLSelectElement).value as 'never'; })}>
            <option value="never">Never</option>
            <option value="always">With every check-in</option>
            <option value="random">Randomly</option>
          </select>
        </label>
        {config.antiCheat.verificationPicture === 'random' && (
          <NumberField label="Probability" suffix="%" min={0} max={100} value={Math.round(config.antiCheat.verificationProbability * 100)} onChange={(v) => edit((d) => { d.antiCheat.verificationProbability = (v ?? 0) / 100; })} />
        )}
        <NumberField
          path="antiCheat.liveVerificationEveryHours"
          label="Live tracking only: random verification picture on average every"
          suffix="hours, empty = off"
          optional
          min={1}
          max={168}
          disabled={checkinMode(T) !== 'auto'}
          value={config.antiCheat.liveVerificationEveryHours}
          hint={checkinMode(T) === 'auto' ? undefined : 'Needs "Background tracking only" in the Tracking tab.'}
          onChange={(v) => edit((d) => { d.antiCheat.liveVerificationEveryHours = v; })}
        />
      </div>
      {config.antiCheat.onImplausible === 'reject_and_penalize' && (
        <ConsequenceEditor label="Penalty for implausible movement" value={config.antiCheat.implausibleConsequences} commands={commands} onChange={(v) => edit((d) => { d.antiCheat.implausibleConsequences = v; })} />
      )}
      <p class="small muted">Verification pictures require the Verification Picture extension on the lock.</p>
    </div>
  );
}
