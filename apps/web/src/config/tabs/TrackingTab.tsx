import { owntracksMonitoring, type LockationConfig } from '@lockation/core';
import { ConsequenceEditor, NumberField, TimeRange } from '../editors.js';
import { heartbeatWarningText } from '../helpers.js';
import type { TabProps } from '../shared.js';

export type CheckinMode = 'manual' | 'both' | 'auto';

/** One selector for tracking on/off and the check-in mode. */
export function checkinMode(t: LockationConfig['tracking']): CheckinMode {
  return t.enabled ? t.checkins : 'manual';
}

export function setCheckinMode(d: LockationConfig, mode: CheckinMode) {
  d.tracking.enabled = mode !== 'manual';
  d.tracking.checkins = mode === 'auto' ? 'auto' : 'both';
  if (mode !== 'auto') delete d.antiCheat.liveVerificationEveryHours;
}

export function TrackingTab({ config, edit, commands }: TabProps) {
  const T = config.tracking;
  return (
    <div class="card stack">
      <h2>Check-ins &amp; background tracking</h2>
      <label class="field">
        How is the wearer's location collected?
        <select data-testid="checkin-mode" value={checkinMode(T)} onChange={(e) => edit((d) => setCheckinMode(d, (e.target as HTMLSelectElement).value as CheckinMode))}>
          <option value="manual">Manual check-ins only</option>
          <option value="both">Manual check-ins + background tracking (OwnTracks)</option>
          <option value="auto">Background tracking only – no manual check-ins</option>
        </select>
        <span class="small muted">
          {{
            manual: 'The wearer taps "Check in" in Lockation. The position is only known at these moments.',
            both: 'The free OwnTracks app (iPhone / Android) reports the position in the background; manual check-ins still work. Both count for required zones.',
            auto: 'Only OwnTracks counts – the check-in button is hidden. The wearer must keep OwnTracks running.',
          }[checkinMode(T)]}
        </span>
      </label>
      {T.enabled && (
        <>
          <div class="grid2">
            <NumberField path="tracking.heartbeatMinutes" label="Missing signal after" suffix="minutes" min={15} value={T.heartbeatMinutes} hint={heartbeatWarningText(T.heartbeatMinutes, T.warnBeforeMinutes)} onChange={(v) => edit((d) => { d.tracking.heartbeatMinutes = v ?? 20; })} />
            <NumberField path="tracking.warnBeforeMinutes" label="Warn before a missing-signal penalty" suffix="minutes, empty = off" optional min={10} max={Math.max(10, T.heartbeatMinutes - 1)} value={T.warnBeforeMinutes} hint="At least 10 minutes and less than the missing-signal time." onChange={(v) => edit((d) => { d.tracking.warnBeforeMinutes = v; })} />
            <NumberField label="Accept delayed updates up to" suffix="minutes" min={1} value={T.maxDelayMinutes} onChange={(v) => edit((d) => { d.tracking.maxDelayMinutes = v ?? 1440; })} />
            <label class="field">
              OwnTracks mode
              <select value={T.owntracksMode} onChange={(e) => edit((d) => { d.tracking.owntracksMode = (e.target as HTMLSelectElement).value as 'auto'; })}>
                <option value="auto">Auto (currently {owntracksMonitoring(config) === 2 ? 'Move' : 'Significant'})</option>
                <option value="move">Move – frequent updates</option>
                <option value="significant">Significant – battery saving</option>
              </select>
              <span class="small muted" data-testid="owntracks-mode">
                {owntracksMonitoring(config) === 2
                  ? 'Move mode: frequent reports, needed for short missing-signal times and forbidden-zone timelines – uses noticeably more battery.'
                  : 'Significant mode: reports only after larger movements – saves battery, but a phone lying still may report rarely.'}
                {T.owntracksMode === 'auto' && ' Auto picks Move if the missing-signal time is under 60 min or forbidden zones are enabled.'}
              </span>
            </label>
            <TimeRange label="Quiet hours – no missing-signal penalty or warning" value={T.quietHours} onChange={(v) => edit((d) => { d.tracking.quietHours = v; })} />
          </div>
          <ConsequenceEditor label="When no location arrives in time (phone off, app stopped, not set up)" repeating="missing signal" value={T.onHeartbeatMissed} commands={commands} onChange={(v) => edit((d) => { d.tracking.onHeartbeatMissed = v; })} />
        </>
      )}
    </div>
  );
}
