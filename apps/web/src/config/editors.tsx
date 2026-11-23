import { ConsequenceSchema, PLANNED_EXTENSIONS, type Consequence, type Zone } from '@lockation/core';
import { useState } from 'preact/hooks';
import type { CommandInfo } from '../lib/backend.js';

export function NumberField(props: { label: string; value: number | undefined; onChange: (v: number | undefined) => void; min?: number; max?: number; step?: number; optional?: boolean; suffix?: string; hint?: string }) {
  return (
    <label class="field">
      {props.label}
      {props.suffix ? ` (${props.suffix})` : ''}
      <input
        type="number"
        inputMode="decimal"
        value={props.value ?? ''}
        min={props.min}
        max={props.max}
        step={props.step ?? 1}
        placeholder={props.optional ? 'off' : undefined}
        onInput={(e) => {
          const raw = (e.target as HTMLInputElement).value;
          props.onChange(raw === '' ? (props.optional ? undefined : 0) : Number(raw));
        }}
      />
      {props.hint && <span class="small muted">{props.hint}</span>}
    </label>
  );
}

export function ZonePicker({ zones, value, onChange }: { zones: Zone[]; value: string[]; onChange: (ids: string[]) => void }) {
  if (!zones.length) return <p class="small muted">Add zones on the map first.</p>;
  return (
    <div class="row">
      {zones.map((z) => (
        <label class="check" key={z.id}>
          <input
            type="checkbox"
            checked={value.includes(z.id)}
            onChange={(e) => onChange((e.target as HTMLInputElement).checked ? [...value, z.id] : value.filter((v) => v !== z.id))}
          />
          {z.name}
        </label>
      ))}
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
  }
}

function minutesOf(seconds: number) {
  return Math.round(seconds / 60);
}

export function ConsequenceEditor({ label, value, onChange, commands }: { label: string; value: Consequence[]; onChange: (v: Consequence[]) => void; commands: CommandInfo[] }) {
  const [adding, setAdding] = useState<Consequence['type']>('add_time');
  const set = (i: number, c: Consequence) => onChange(value.map((v, j) => (j === i ? c : v)));
  return (
    <div class="cons">
      <div class="small"><strong>{label}</strong></div>
      {value.length === 0 && <div class="small muted">Nothing happens.</div>}
      {value.map((c, i) => (
        <div class="cons-item" key={i}>
          <ConsequenceFields c={c} onChange={(n) => set(i, n)} commands={commands} />
          <button class="link danger" aria-label="remove" onClick={() => onChange(value.filter((_, j) => j !== i))}>
            ✕
          </button>
        </div>
      ))}
      {value.length < 10 && (
        <div class="row">
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
