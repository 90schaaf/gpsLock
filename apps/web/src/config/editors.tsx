import { BODY_PARTS, ConsequenceSchema, MAX_WINDOWS, PLANNED_EXTENSIONS, TOY_SHAPES, TOY_TYPE_IDS, TOY_TYPES, WEEKDAYS, type Consequence, type TimeWindow, type ToyConsequence, type ToyEffect, type ToyType, type Weekday, type When } from '@lockation/core';
import { useState } from 'preact/hooks';
import type { CommandInfo } from '../lib/backend.js';
import { useFieldIssues } from './issues.js';

/** Inline validation messages of one field. */
export function FieldErrors({ messages }: { messages: string[] }) {
  if (!messages.length) return null;
  return (
    <span class="field-error" role="alert">
      {messages.join(' ')}
    </span>
  );
}

export function NumberField(props: {
  label: string;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  min?: number;
  max?: number;
  step?: number;
  optional?: boolean;
  suffix?: string;
  hint?: string;
  placeholder?: string;
  disabled?: boolean;
  /** Config path (e.g. "tracking.warnBeforeMinutes") – shows validation errors of this field inline. */
  path?: string;
}) {
  const errors = useFieldIssues(props.path);
  return (
    <label class={errors.length ? "field invalid" : "field"}>
      {props.label}
      {props.suffix ? ` (${props.suffix})` : ''}
      <input
        type="number"
        inputMode="decimal"
        value={props.value ?? ''}
        min={props.min}
        max={props.max}
        step={props.step ?? 1}
        disabled={props.disabled}
        placeholder={props.placeholder ?? (props.optional ? 'off' : undefined)}
        onInput={(e) => {
          const raw = (e.target as HTMLInputElement).value;
          props.onChange(raw === '' ? (props.optional ? undefined : 0) : Number(raw));
        }}
      />
      {props.hint && <span class="small muted">{props.hint}</span>}
      <FieldErrors messages={errors} />
    </label>
  );
}

/** Per-zone override: empty = inherit the rule value (shown as placeholder). */
export function OverrideField(props: {
  label: string;
  value: number | undefined;
  inherited: number;
  onChange: (v: number | undefined) => void;
  min?: number;
  max?: number;
  suffix?: string;
  format?: (n: number) => string;
  path?: string;
}) {
  return (
    <NumberField
      path={props.path}
      label={props.label}
      suffix={props.suffix}
      optional
      min={props.min}
      max={props.max}
      value={props.value}
      placeholder={`default: ${props.format ? props.format(props.inherited) : props.inherited}`}
      onChange={props.onChange}
    />
  );
}

/**
 * A minutes value that can be switched off (`null`). With `inherited` set, a third state "default" (`undefined`)
 * inherits the rule value (per-zone override).
 */
export function NullableMinutesField(props: {
  label: string;
  value: number | null | undefined;
  onChange: (v: number | null | undefined) => void;
  min?: number;
  max?: number;
  fallback: number;
  inherited?: { value: number | null; format: (v: number | null) => string };
  path?: string;
}) {
  const errors = useFieldIssues(props.path);
  const mode = props.value === undefined ? (props.inherited ? 'inherit' : 'value') : props.value === null ? 'off' : 'value';
  return (
    <label class={errors.length ? "field invalid" : "field"}>
      {props.label}
      <span class="row nowrap">
        <select
          class="grow"
          value={mode}
          onChange={(e) => {
            const m = (e.target as HTMLSelectElement).value;
            props.onChange(m === 'inherit' ? undefined : m === 'off' ? null : (props.value ?? props.fallback));
          }}
        >
          {props.inherited && <option value="inherit">Default ({props.inherited.format(props.inherited.value)})</option>}
          <option value="off">Off</option>
          <option value="value">After … minutes</option>
        </select>
        {mode === 'value' && (
          <input
            type="number"
            class="num"
            inputMode="decimal"
            aria-label={`${props.label} (minutes)`}
            min={props.min}
            max={props.max}
            value={props.value ?? props.fallback}
            onInput={(e) => {
              const raw = (e.target as HTMLInputElement).value;
              props.onChange(raw === '' ? props.fallback : Number(raw));
            }}
          />
        )}
      </span>
      <FieldErrors messages={errors} />
    </label>
  );
}

/** Optional daily time range (quiet hours). */
export function TimeRange({ value, onChange, label }: { value: { start: string; end: string } | undefined; onChange: (v: { start: string; end: string } | undefined) => void; label: string }) {
  return (
    <div class="stack">
      <label class="check">
        <input type="checkbox" checked={!!value} onChange={(e) => onChange((e.target as HTMLInputElement).checked ? { start: '23:00', end: '07:00' } : undefined)} />
        {label}
      </label>
      {value && (
        <div class="row nowrap">
          <input type="time" aria-label="from" value={value.start} onInput={(e) => onChange({ ...value, start: (e.target as HTMLInputElement).value })} />
          –
          <input type="time" aria-label="until" value={value.end} onInput={(e) => onChange({ ...value, end: (e.target as HTMLInputElement).value })} />
        </div>
      )}
    </div>
  );
}

const DAY_LABEL: Record<Weekday, string> = { mon: 'Mo', tue: 'Tu', wed: 'We', thu: 'Th', fri: 'Fr', sat: 'Sa', sun: 'Su' };

/** Time window rows: from, to, weekday chips (none = every day), add/remove. */
export function WindowsEditor({ value, onChange, addLabel = 'Add time window' }: { value: TimeWindow[]; onChange: (v: TimeWindow[]) => void; addLabel?: string }) {
  const set = (i: number, w: TimeWindow) => onChange(value.map((x, j) => (j === i ? w : x)));
  return (
    <div class="stack" data-testid="windows-editor">
      {value.map((w, i) => (
        <div class="window-row" key={i}>
          <div class="row nowrap">
            <input type="time" aria-label="from" value={w.start} onInput={(e) => set(i, { ...w, start: (e.target as HTMLInputElement).value })} />
            –
            <input type="time" aria-label="until" value={w.end} onInput={(e) => set(i, { ...w, end: (e.target as HTMLInputElement).value })} />
            <button type="button" class="link danger" aria-label="remove window" onClick={() => onChange(value.filter((_, j) => j !== i))}>
              ✕
            </button>
          </div>
          <div class="chips" role="group" aria-label="weekdays">
            {WEEKDAYS.map((d) => {
              const on = !!w.days?.includes(d);
              return (
                <button
                  key={d}
                  type="button"
                  class={`chip${on ? ' active' : ''}`}
                  aria-pressed={on}
                  onClick={() => {
                    const days = WEEKDAYS.filter((x) => (x === d ? !on : !!w.days?.includes(x)));
                    set(i, days.length ? { ...w, days } : { start: w.start, end: w.end });
                  }}
                >
                  {DAY_LABEL[d]}
                </button>
              );
            })}
            {!w.days?.length && <span class="small muted">every day</span>}
          </div>
        </div>
      ))}
      {value.length < MAX_WINDOWS && (
        <div>
          <button type="button" onClick={() => onChange([...value, { start: '20:00', end: '23:00' }])}>
            ➕ {addLabel}
          </button>
        </div>
      )}
    </div>
  );
}

const TYPES: { type: Consequence['type']; label: string }[] = [
  { type: 'add_time', label: '➕ Add time' },
  { type: 'remove_time', label: '➖ Remove time' },
  { type: 'freeze', label: '❄️ Freeze' },
  { type: 'unfreeze', label: '🔥 Unfreeze' },
  { type: 'pillory', label: '🪵 Pillory' },
  { type: 'task', label: '✅ Assign task' },
  { type: 'verification_picture', label: '📷 Verification picture' },
  { type: 'log', label: '📝 Log only' },
  { type: 'command', label: '🔌 Other extension command' },
  { type: 'toy', label: '🎮 Toy (XToys)' },
];

export function defaultConsequence(type: Consequence['type']): Consequence {
  switch (type) {
    case 'add_time':
    case 'remove_time':
      return { type, seconds: 3600 };
    case 'freeze':
      return { type };
    case 'unfreeze':
    case 'verification_picture':
      return { type };
    case 'pillory':
      return { type, durationMinutes: 30, reason: 'Lockation rule broken' };
    case 'task':
      return { type, task: 'Describe the task', points: 0, verificationRequired: false };
    case 'log':
      return { type, message: 'Note for the keyholder' };
    case 'command':
      return { type, commandId: 'tasks.assign', input: {} };
    case 'toy':
      return { type, action: 'play', target: { bodyPart: 'all' }, shape: 'pulse', intensity: 50, seconds: 30 };
  }
}

function minutesOf(seconds: number) {
  return Math.round(seconds / 60);
}

export function ConsequenceEditor({
  label,
  value,
  onChange,
  commands,
  repeating,
}: {
  label: string;
  value: Consequence[];
  onChange: (v: Consequence[]) => void;
  commands: CommandInfo[];
  /** The list applies repeatedly (e.g. "penalty", "missed check-in"): shows a "when" selector per row. */
  repeating?: string;
}) {
  const [adding, setAdding] = useState<Consequence['type']>('add_time');
  const set = (i: number, c: Consequence) => onChange(value.map((v, j) => (j === i ? c : v)));
  return (
    <div class="cons">
      <div class="small"><strong>{label}</strong></div>
      {value.length === 0 && <div class="small muted">Nothing happens.</div>}
      {value.map((c, i) => (
        <div class="cons-item" key={i}>
          <div class="stack">
            <ConsequenceFields c={c} onChange={(n) => set(i, n)} commands={commands} />
            {repeating && <WhenSelect value={c.when} noun={repeating} onChange={(when) => set(i, withWhen(c, when))} />}
          </div>
          <button class="link danger" aria-label="remove" onClick={() => onChange(value.filter((_, j) => j !== i))}>
            ✕
          </button>
        </div>
      ))}
      {value.length < 10 && (
        <div class="row nowrap">
          <select class="grow" value={adding} onChange={(e) => setAdding((e.target as HTMLSelectElement).value as Consequence['type'])}>
            {TYPES.map((t) => (
              <option key={t.type} value={t.type}>
                {t.label}
              </option>
            ))}
          </select>
          <button onClick={() => onChange([...value, defaultConsequence(adding)])}>Add</button>
        </div>
      )}
    </div>
  );
}

export function withWhen(c: Consequence, when: When | undefined): Consequence {
  const { when: _old, ...rest } = c;
  return (when ? { ...rest, when } : rest) as Consequence;
}

/** "every time / every n-th time / only the n-th time" for consequences in repeating lists. */
export function WhenSelect({ value, onChange, noun }: { value: When | undefined; onChange: (w: When | undefined) => void; noun: string }) {
  const mode = !value || 'every' in value ? 'every' : 'everyNth' in value ? 'everyNth' : 'nth';
  const n = value && 'everyNth' in value ? value.everyNth : value && 'nth' in value ? value.nth : 2;
  return (
    <div class="row nowrap small" data-testid="when-select">
      <select
        class="grow"
        aria-label="when"
        value={mode}
        onChange={(e) => {
          const m = (e.target as HTMLSelectElement).value;
          onChange(m === 'every' ? undefined : m === 'everyNth' ? { everyNth: Math.max(2, n) } : { nth: n });
        }}
      >
        <option value="every">at every {noun}</option>
        <option value="everyNth">at every n-th {noun}</option>
        <option value="nth">only at the n-th {noun}</option>
      </select>
      {mode !== 'every' && (
        <input
          type="number"
          class="num"
          aria-label="n"
          min={mode === 'everyNth' ? 2 : 1}
          max={1000}
          value={n}
          onInput={(e) => {
            const v = Math.round(Number((e.target as HTMLInputElement).value) || 0);
            onChange(mode === 'everyNth' ? { everyNth: Math.min(1000, Math.max(2, v)) } : { nth: Math.min(1000, Math.max(1, v)) });
          }}
        />
      )}
    </div>
  );
}

function ConsequenceFields({ c, onChange, commands }: { c: Consequence; onChange: (c: Consequence) => void; commands: CommandInfo[] }) {
  const title = TYPES.find((t) => t.type === c.type)?.label;
  const valid = ConsequenceSchema.safeParse(c).success;
  return (
    <div class="stack">
      <div class="small">
        <strong>{title}</strong> {!valid && <span class="error">(invalid)</span>}
      </div>
      {(c.type === 'add_time' || c.type === 'remove_time') && (
        <NumberField label="Minutes" value={minutesOf(c.seconds)} min={1} onChange={(v) => onChange({ ...c, seconds: Math.max(1, (v ?? 1) * 60) })} />
      )}
      {c.type === 'toy' && <ToyFields c={c} onChange={onChange} />}
      {c.type === 'freeze' && (
        <NumberField label="Duration in minutes – empty = until unfrozen" optional value={c.durationMinutes} min={1} onChange={(v) => onChange({ ...c, durationMinutes: v })} />
      )}
      {c.type === 'pillory' && (
        <div class="grid2">
          <NumberField label="Minutes (5–1440)" value={c.durationMinutes} min={5} max={1440} onChange={(v) => onChange({ ...c, durationMinutes: v ?? 5 })} />
          <label class="field">
            Reason
            <input value={c.reason} maxLength={500} onInput={(e) => onChange({ ...c, reason: (e.target as HTMLInputElement).value })} />
          </label>
        </div>
      )}
      {c.type === 'task' && (
        <div class="grid2">
          <label class="field">
            Task
            <input value={c.task} maxLength={200} onInput={(e) => onChange({ ...c, task: (e.target as HTMLInputElement).value })} />
          </label>
          <NumberField label="Points" value={c.points} min={0} onChange={(v) => onChange({ ...c, points: v ?? 0 })} />
          <NumberField label="Timed task minutes" optional value={c.durationMinutes} min={1} max={1440} onChange={(v) => onChange({ ...c, durationMinutes: v })} />
          <label class="check">
            <input type="checkbox" checked={c.verificationRequired} onChange={(e) => onChange({ ...c, verificationRequired: (e.target as HTMLInputElement).checked })} />
            Verification required
          </label>
        </div>
      )}
      {c.type === 'log' && (
        <label class="field">
          Message
          <input value={c.message} maxLength={500} onInput={(e) => onChange({ ...c, message: (e.target as HTMLInputElement).value })} />
        </label>
      )}
      {c.type === 'command' && <CommandFields c={c} onChange={onChange} commands={commands} />}
    </div>
  );
}

function CommandFields({ c, onChange, commands }: { c: Extract<Consequence, { type: 'command' }>; onChange: (c: Consequence) => void; commands: CommandInfo[] }) {
  const [text, setText] = useState(JSON.stringify(c.input, null, 2));
  const [err, setErr] = useState<string>();
  const known = commands.find((k) => k.id === c.commandId);
  return (
    <div class="stack">
      <label class="field">
        Command
        <select
          value={commands.some((k) => k.id === c.commandId) ? c.commandId : '__custom'}
          onChange={(e) => {
            const id = (e.target as HTMLSelectElement).value;
            if (id === '__custom') return;
            const k = commands.find((x) => x.id === id);
            const input = k?.exampleInput ?? {};
            setText(JSON.stringify(input, null, 2));
            onChange({ ...c, commandId: id, input });
          }}
        >
          {commands.map((k) => (
            <option key={k.id} value={k.id} disabled={!k.available}>
              {k.extension}: {k.title} ({k.id}){k.available ? '' : ' – unavailable'}
            </option>
          ))}
          <option value="__custom">Custom command id…</option>
        </select>
      </label>
      <label class="field">
        Command id
        <input value={c.commandId} onInput={(e) => onChange({ ...c, commandId: (e.target as HTMLInputElement).value.trim() })} />
      </label>
      {known && <div class="small muted">{known.description}</div>}
      <label class="field">
        Input (JSON)
        <textarea
          rows={3}
          value={text}
          onInput={(e) => {
            const v = (e.target as HTMLTextAreaElement).value;
            setText(v);
            try {
              const parsed = JSON.parse(v || '{}');
              if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('must be an object');
              setErr(undefined);
              onChange({ ...c, input: parsed });
            } catch (x) {
              setErr(x instanceof Error ? x.message : 'invalid JSON');
            }
          }}
        />
      </label>
      {err && <div class="error small">{err}</div>}
      <div class="small muted">
        Experimental Chaster feature. Not yet controllable (no commands published): {PLANNED_EXTENSIONS.join(', ')} – they will appear here automatically once available.
      </div>
    </div>
  );
}

/** F27 – a toy action: target (body part, optional toy type / channel), action and its values. */
function ToyFields({ c, onChange }: { c: ToyConsequence; onChange: (c: Consequence) => void }) {
  const set = (patch: Partial<ToyConsequence>) => onChange({ ...c, ...patch } as Consequence);
  const target = (patch: Partial<ToyConsequence['target']>) => {
    const t = { ...c.target, ...patch };
    for (const k of Object.keys(t) as (keyof typeof t)[]) if (t[k] === undefined || t[k] === '') delete t[k];
    set({ target: t as ToyConsequence['target'] });
  };
  const channels = c.target.toyType ? (TOY_TYPES[c.target.toyType].channels as readonly string[]) : ['A', 'B'];
  const relative = c.action === 'intensity' && c.delta !== undefined;
  return (
    <div class="stack" data-testid="toy-fields">
      <div class="grid2">
        <label class="field">
          Action
          <select
            value={c.action}
            onChange={(e) => {
              const action = (e.target as HTMLSelectElement).value as ToyConsequence['action'];
              const base = { type: 'toy' as const, target: c.target, ...(c.when ? { when: c.when } : {}) };
              onChange(
                (action === 'play'
                  ? { ...base, action, shape: c.shape ?? 'pulse', intensity: c.intensity ?? 50, seconds: c.seconds ?? 30 }
                  : action === 'intensity'
                    ? { ...base, action, delta: 10 }
                    : action === 'shock'
                      ? { ...base, action, intensity: c.intensity ?? 30, seconds: 1, target: { ...c.target, toyType: 'estim' as ToyType } }
                      : { ...base, action }) as Consequence,
              );
            }}
          >
            <option value="play">Play a pattern</option>
            <option value="intensity">Change the intensity</option>
            <option value="shock">⚡ Shock (e-stim)</option>
            <option value="stop">Stop</option>
          </select>
        </label>
        <label class="field">
          Body part
          <select value={c.target.bodyPart} onChange={(e) => target({ bodyPart: (e.target as HTMLSelectElement).value })}>
            <option value="all">All toys</option>
            {BODY_PARTS.map((b) => (
              <option key={b} value={b}>{b}</option>
            ))}
          </select>
        </label>
        <label class="field">
          Toy type
          <select value={c.target.toyType ?? ''} onChange={(e) => target({ toyType: ((e.target as HTMLSelectElement).value || undefined) as ToyType | undefined, channel: undefined })}>
            <option value="">Any</option>
            {TOY_TYPE_IDS.map((t) => (
              <option key={t} value={t}>{TOY_TYPES[t].label}</option>
            ))}
          </select>
        </label>
        <label class="field">
          Channel
          <select value={c.target.channel ?? ''} onChange={(e) => target({ channel: (e.target as HTMLSelectElement).value || undefined })}>
            <option value="">All channels</option>
            {channels.filter((ch) => ch !== 'main').map((ch) => (
              <option key={ch} value={ch}>{ch}</option>
            ))}
          </select>
        </label>
        {c.action === 'play' && (
          <label class="field">
            Pattern
            <select value={c.shape ?? 'pulse'} onChange={(e) => set({ shape: (e.target as HTMLSelectElement).value as ToyConsequence['shape'] })}>
              {TOY_SHAPES.map((sh) => (
                <option key={sh} value={sh}>{sh}</option>
              ))}
            </select>
          </label>
        )}
        {c.action === 'intensity' && (
          <label class="field">
            Change
            <select
              value={relative ? 'relative' : 'absolute'}
              onChange={(e) => {
                const { delta: _d, intensity: _i, ...rest } = c;
                onChange(((e.target as HTMLSelectElement).value === 'relative' ? { ...rest, delta: 10 } : { ...rest, intensity: 50 }) as Consequence);
              }}
            >
              <option value="relative">by … % (e.g. +10 / −20)</option>
              <option value="absolute">to … %</option>
            </select>
          </label>
        )}
        {relative ? (
          <NumberField label="Change (%)" min={-100} max={100} value={c.delta} onChange={(v) => set({ delta: v ?? 0 })} />
        ) : (
          c.action !== 'stop' && <NumberField label="Intensity (%)" min={0} max={100} value={c.intensity} onChange={(v) => set({ intensity: v ?? 0 })} />
        )}
        {(c.action === 'play' || c.action === 'shock') && (
          <NumberField label={c.action === 'shock' ? 'Shock length (seconds, max 10)' : 'Duration (seconds)'} min={1} max={c.action === 'shock' ? 10 : 3600} value={c.seconds} onChange={(v) => set({ seconds: v ?? 1 })} />
        )}
      </div>
      <span class="small muted">Sent to every connected toy that matches; the wearer's limits always apply. Skipped (and logged) if none is connected.</span>
    </div>
  );
}

/** F27 step 3 – an effect that runs while a condition holds (off = undefined). */
export function ToyEffectEditor({ label, value, onChange, hint }: { label: string; value: ToyEffect | undefined; onChange: (v: ToyEffect | undefined) => void; hint?: string }) {
  const set = (patch: Partial<ToyEffect>) => onChange({ ...value!, ...patch });
  const target = (patch: Partial<ToyEffect['target']>) => {
    const t = { ...value!.target, ...patch };
    for (const k of Object.keys(t) as (keyof typeof t)[]) if (t[k] === undefined || t[k] === '') delete t[k];
    set({ target: t as ToyEffect['target'] });
  };
  const channels = value?.target.toyType ? (TOY_TYPES[value.target.toyType].channels as readonly string[]) : ['A', 'B'];
  return (
    <div class="stack" data-testid="toy-effect">
      <label class="check small">
        <input type="checkbox" checked={!!value} onChange={(e) => onChange((e.target as HTMLInputElement).checked ? { target: { bodyPart: 'all' }, shape: 'pulse', intensity: 40 } : undefined)} />
        <span><strong>{label}</strong>{hint ? <span class="muted"> – {hint}</span> : null}</span>
      </label>
      {value && (
        <div class="grid2">
          <label class="field">
            Body part
            <select value={value.target.bodyPart} onChange={(e) => target({ bodyPart: (e.target as HTMLSelectElement).value })}>
              <option value="all">All toys</option>
              {BODY_PARTS.map((b) => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
          </label>
          <label class="field">
            Toy type
            <select value={value.target.toyType ?? ''} onChange={(e) => target({ toyType: ((e.target as HTMLSelectElement).value || undefined) as ToyType | undefined, channel: undefined })}>
              <option value="">Any</option>
              {TOY_TYPE_IDS.map((t) => (
                <option key={t} value={t}>{TOY_TYPES[t].label}</option>
              ))}
            </select>
          </label>
          <label class="field">
            Channel
            <select value={value.target.channel ?? ''} onChange={(e) => target({ channel: (e.target as HTMLSelectElement).value || undefined })}>
              <option value="">All channels</option>
              {channels.filter((ch) => ch !== 'main').map((ch) => (
                <option key={ch} value={ch}>{ch}</option>
              ))}
            </select>
          </label>
          <label class="field">
            Pattern
            <select value={value.shape} onChange={(e) => set({ shape: (e.target as HTMLSelectElement).value as ToyEffect['shape'] })}>
              {TOY_SHAPES.map((sh) => (
                <option key={sh} value={sh}>{sh}</option>
              ))}
            </select>
          </label>
          <NumberField label="Intensity (%)" min={0} max={100} value={value.intensity} onChange={(v) => set({ intensity: v ?? 0 })} />
        </div>
      )}
    </div>
  );
}
