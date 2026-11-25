import { fmtMinutes, type KeyholderNotifyKind } from '@lockation/core';
import { checked, type TabProps } from '../shared.js';

const KEYHOLDER_SWITCHES: { id: KeyholderNotifyKind; label: string; help: string }[] = [
  { id: 'penalty', label: 'Penalty applied', help: 'Any rule added a penalty, e.g. "Bar: +1 h".' },
  { id: 'forbiddenEntered', label: 'Forbidden zone entered', help: 'At the first warning time – before the first penalty.' },
  { id: 'tracking', label: 'Background tracking', help: 'Missing signal, tracking set up or stopped.' },
  { id: 'requiredMissed', label: 'Required check-in missed', help: 'A required check-in deadline passed.' },
  { id: 'requiredDone', label: 'Required check-in done', help: 'Every successful required check-in.' },
  { id: 'hunt', label: 'Scavenger hunt', help: 'Checkpoint found, hunt completed or failed.' },
  { id: 'surprise', label: 'Surprise zones', help: 'The wearer entered a surprise zone, was released or left too early.' },
  { id: 'mission', label: 'Surprise missions', help: 'Random mission sent, accomplished, failed or declined.' },
  { id: 'reward', label: 'Reward earned', help: 'The wearer earned a reward in a reward zone.' },
  { id: 'verification', label: 'Verification picture', help: 'A verification picture was requested.' },
];

export function NotificationsTab({ config, edit }: TabProps) {
  const R = config.rules;
  const T = config.tracking;
  return (
    <div class="card stack">
      <h2>🔔 Notifications</h2>
      <p class="small muted" style={{ margin: 0 }}>
        Push notifications use the free <strong>ntfy</strong> app. Wearer and keyholder each tap <em>Set up notifications</em> on the lock page. Texts contain zone names and consequences, never coordinates.
      </p>
      <h3>Keyholder – notify me about</h3>
      <ul class="plain">
        {KEYHOLDER_SWITCHES.map((s) => (
          <li key={s.id}>
            <label class="check">
              <input type="checkbox" data-testid={`notify-${s.id}`} checked={config.notifications.keyholder[s.id]} onChange={(e) => edit((d) => { d.notifications.keyholder[s.id] = checked(e); })} />
              <span>
                {s.label} <span class="small muted">– {s.help}</span>
              </span>
            </label>
          </li>
        ))}
      </ul>
      <h3>Wearer warnings</h3>
      <ul class="small">
        <li>Forbidden zones: {R.forbidden.enabled ? (R.forbidden.firstWarningAfterMinutes === null && R.forbidden.repeatWarningAfterMinutes === null ? 'warnings off' : 'warnings before penalties (Forbidden tab)') : 'rule off'}.</li>
        <li>Required check-ins: {R.required.enabled && R.required.warnBeforeMinutes ? `warning ${fmtMinutes(R.required.warnBeforeMinutes)} before a deadline` : 'no warning (Required tab)'}.</li>
        <li>Missing signal: {T.enabled && T.warnBeforeMinutes ? `warning ${fmtMinutes(T.warnBeforeMinutes)} before the penalty` : 'no warning (Tracking tab)'}.</li>
        <li>Rule changes during a running lock are always announced.</li>
      </ul>
    </div>
  );
}
