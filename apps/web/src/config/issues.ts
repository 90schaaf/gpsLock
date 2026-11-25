/**
 * Inline validation: which tab an issue belongs to, a readable label ("Bar › First warning"), and whether a field shows
 * the issue itself (then the tab-level list skips it).
 */
import type { ConfigIssue, LockationConfig } from '@lockation/core';
import { createContext } from 'preact';
import { useContext } from 'preact/hooks';

export type Tab = 'zones' | 'required' | 'forbidden' | 'reward' | 'travel' | 'hunt' | 'surprise' | 'mission' | 'toy' | 'tracking' | 'notify' | 'anticheat' | 'privacy' | 'file';

export function issueTab(path: string): Tab {
  const p = path.split('.');
  if (p[0] === 'zones' && p.length > 2 && (p[2] === 'required' || p[2] === 'forbidden' || p[2] === 'reward' || p[2] === 'surprise')) return p[2];
  if (p[0] === 'rules') {
    const r = p[1];
    if (r === 'required' || r === 'forbidden' || r === 'reward' || r === 'travel' || r === 'hunt' || r === 'mission' || r === 'surprise' || r === 'toy') return r;
  }
  if (p[0] === 'tracking') return 'tracking';
  if (p[0] === 'notifications') return 'notify';
  if (p[0] === 'antiCheat') return 'anticheat';
  if (p[0] === 'privacy') return 'privacy';
  return 'zones'; // zones, timezone, matchMode, disclaimer, …
}

const FIELD: Record<string, string> = {
  name: 'Name',
  radiusM: 'Radius',
  lat: 'Position',
  lng: 'Position',
  roles: 'Role',
  matchMode: 'Matching',
  id: 'ID',
  intervalMinutes: 'Interval',
  graceMinutes: 'Grace period',
  warnBeforeMinutes: 'Warning before',
  windowCooldownMinutes: 'Cooldown (stay windows)',
  stayWindows: 'Stay-inside windows',
  windows: 'Time windows',
  start: 'From',
  end: 'To',
  days: 'Weekdays',
  quietHours: 'Quiet hours',
  firstWarningAfterMinutes: 'First warning',
  firstPenaltyAfterMinutes: 'First penalty',
  repeatEveryMinutes: 'Repeat every',
  repeatWarningAfterMinutes: 'Warning after each penalty',
  cooldownMinutes: 'Cooldown',
  maxPerDay: 'Max per day',
  dwellMinutes: 'Minimum stay',
  stepKm: 'Step size',
  maxKmPerCheckin: 'Max per check-in',
  dailyCapKm: 'Daily cap',
  checkpoints: 'Checkpoints',
  mission: 'Surprise missions',
  surprise: 'Surprise',
  toy: 'Toys',
  onEmergencyStop: 'Emergency stop',
  outcomes: 'Outcomes',
  holdMinutes: 'Hold time',
  label: 'Text',
  weight: 'Chance',
  zoneIds: 'Target zones',
  leadMinutes: 'Time to get there',
  declinesPerDay: 'Declines per day',
  everyMinutes: 'On average every',
  minDistanceM: 'Minimum distance',
  random: 'Random route',
  min: 'At least',
  max: 'At most',
  hint: 'Hint',
  timeLimitMinutes: 'Time limit',
  wrongCooldownMinutes: 'Wrong-guess cooldown',
  heartbeatMinutes: 'Missing signal after',
  maxDelayMinutes: 'Accept delayed updates',
  checkins: 'Check-in mode',
  minStayMinutes: 'Minimum stay',
  maxAccuracyM: 'Required accuracy',
  maxFixAgeSeconds: 'Max position age',
  maxSpeedKmh: 'Max plausible speed',
  minIntervalSeconds: 'Min time between check-ins',
  verificationProbability: 'Verification probability',
  liveVerificationEveryHours: 'Random verification pictures',
  seconds: 'Time',
  durationMinutes: 'Duration',
  reason: 'Reason',
  task: 'Task',
  message: 'Message',
  commandId: 'Command',
  timezone: 'Timezone',
};

const LISTS: Record<string, string> = {
  onSuccess: 'On success',
  onOutside: 'Outside a zone',
  onMissed: 'When missed',
  onOutsideDuringWindow: 'Outside during a window',
  onEnter: 'Consequences',
  onStep: 'For every step',
  onCheckpoint: 'Each checkpoint',
  onWrong: 'Wrong guess',
  onComplete: 'Completed',
  onTimeout: 'Time limit exceeded',
  onHeartbeatMissed: 'Missing signal',
  onLeave: 'On leave',
  implausibleConsequences: 'Implausible movement',
};

/** Readable location of an issue, e.g. "Bar › Extra punishment #2 › Time". Empty for rule-level "enabled" issues. */
export function issueLabel(path: string, config: LockationConfig | undefined): string {
  const p = path.split('.');
  const parts: string[] = [];
  let i = 0;
  if (p[0] === 'zones' && p[1] !== undefined && /^\d+$/.test(p[1])) {
    parts.push(config?.zones[Number(p[1])]?.name || `Zone ${Number(p[1]) + 1}`);
    i = 2;
    if (p[i] === 'required' || p[i] === 'forbidden' || p[i] === 'reward' || p[i] === 'actions') i += 1;
  } else if (p[0] === 'rules') {
    i = 2;
    if (p[1] === 'hunt' && p[2] === 'checkpoints' && p[3] !== undefined && /^\d+$/.test(p[3])) {
      parts.push(config?.rules.hunt.checkpoints[Number(p[3])]?.name || `Checkpoint ${Number(p[3]) + 1}`);
      i = 4;
    }
  } else if (p[0] === 'tracking' || p[0] === 'antiCheat' || p[0] === 'privacy' || p[0] === 'notifications') {
    i = 1;
  }
  for (; i < p.length; i++) {
    const seg = p[i]!;
    if (seg === 'enabled') continue;
    if (LISTS[seg]) {
      const n = p[i + 1];
      if (p[i - 1] === 'actions' && seg === 'onEnter') {
        const n2 = p[i + 1];
        parts.push(`On enter${n2 !== undefined && /^\d+$/.test(n2) ? ` #${Number(n2) + 1}` : ''}`);
        if (n2 !== undefined && /^\d+$/.test(n2)) i += 1;
        continue;
      }
      const zoneExtra = p[0] === 'zones' && seg === 'onEnter' ? 'Extra' : '';
      parts.push(`${zoneExtra ? `${zoneExtra} ` : ''}${zoneExtra ? LISTS[seg]!.toLowerCase() : LISTS[seg]}${n !== undefined && /^\d+$/.test(n) ? ` #${Number(n) + 1}` : ''}`);
      if (n !== undefined && /^\d+$/.test(n)) i += 1;
      continue;
    }
    if (/^\d+$/.test(seg)) {
      parts.push(`#${Number(seg) + 1}`);
      continue;
    }
    parts.push(FIELD[seg] ?? seg);
  }
  return [...new Set(parts)].join(' › ');
}

/** Rule-level fields that render their own error message (when their section is visible). */
const INLINE: { re: RegExp; visible: (c: LockationConfig) => boolean }[] = [
  { re: /^rules\.forbidden\.(firstWarningAfterMinutes|repeatWarningAfterMinutes)$/, visible: (c) => c.rules.forbidden.enabled },
  { re: /^rules\.required\.(warnBeforeMinutes|intervalMinutes)$/, visible: (c) => c.rules.required.enabled },
  { re: /^tracking\.(heartbeatMinutes|warnBeforeMinutes)$/, visible: (c) => c.tracking.enabled },
  { re: /^rules\.mission\.(leadMinutes|warnBeforeMinutes|declinesPerDay)$/, visible: (c) => c.rules.mission.enabled },
  { re: /^zones\.\d+\.surprise\.outcomes\.\d+\.holdMinutes$/, visible: (c) => c.rules.surprise.enabled },
  { re: /^antiCheat\.liveVerificationEveryHours$/, visible: () => true },
];

export function shownInline(path: string, config: LockationConfig | undefined): boolean {
  return !!config && INLINE.some((x) => x.re.test(path) && x.visible(config));
}

export function issuesForTab(issues: ConfigIssue[], tab: Tab, config: LockationConfig | undefined): ConfigIssue[] {
  return issues.filter((i) => issueTab(i.path) === tab && !shownInline(i.path, config));
}

export function countByTab(issues: ConfigIssue[]): Partial<Record<Tab, number>> {
  const out: Partial<Record<Tab, number>> = {};
  for (const i of issues) {
    const t = issueTab(i.path);
    out[t] = (out[t] ?? 0) + 1;
  }
  return out;
}

/** Current issues for field-level display. */
export const IssuesContext = createContext<ConfigIssue[]>([]);

export function useFieldIssues(path: string | undefined): string[] {
  const all = useContext(IssuesContext);
  if (!path) return [];
  return all.filter((i) => i.path === path).map((i) => i.message);
}
