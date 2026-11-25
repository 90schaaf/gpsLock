import { isValidTimezone, MIN_RADIUS_M, utcToZonedWallTime, zonedWallTimeToUtc } from '@lockation/core';
import { ConsequenceEditor, NumberField } from '../editors.js';
import { useState } from 'preact/hooks';
import { checked, PlacesInfo, ReachNote, Section, setAck, val, type TabProps } from '../shared.js';

/** datetime-local value (wall time in the lock timezone) for a stored UTC instant. */
function startAtInput(iso: string | undefined, tz: string): string {
  return iso && isValidTimezone(tz) ? utcToZonedWallTime(iso, tz) : '';
}

/** Stored UTC instant (ISO) for a datetime-local value entered in the lock timezone. */
function startAtValue(local: string, tz: string): string | undefined {
  return local && isValidTimezone(tz) ? zonedWallTimeToUtc(local, tz)?.toISOString() : undefined;
}

export function HuntTab({ config, edit, commands, reach, selected, setSelected, demo }: TabProps) {
  const R = config.rules;
  return (
    <Section title="Scavenger hunt" enabled={R.hunt.enabled} onToggle={(v) => edit((d) => { d.rules.hunt.enabled = v; })}
      help="Checkpoints are found by checking in (or walking in with background tracking). In order: only the current checkpoint counts; any order: every open checkpoint counts.">
      <PlacesInfo config={config} />
      <ol class="stack" style={{ paddingLeft: '18px' }}>
        {R.hunt.checkpoints.map((c, i) => (
          <li key={c.id} onClick={() => setSelected(c.id)} style={{ outline: c.id === selected ? '2px solid var(--accent)' : undefined, borderRadius: '8px', padding: '4px' }} data-testid="checkpoint-item">
            <div class="row">
              <input class="grow" value={c.name} maxLength={60} aria-label="checkpoint name" onInput={(e) => edit((d) => { d.rules.hunt.checkpoints[i]!.name = val(e); })} />
              <input type="number" style={{ width: '80px' }} value={c.radiusM} min={MIN_RADIUS_M} aria-label="radius" onInput={(e) => edit((d) => { d.rules.hunt.checkpoints[i]!.radiusM = Number(val(e)); })} />
              <button class="link" disabled={i === 0} aria-label="move up" onClick={() => edit((d) => { const a = d.rules.hunt.checkpoints; [a[i - 1], a[i]] = [a[i]!, a[i - 1]!]; })}>↑</button>
              <button class="link" disabled={i === R.hunt.checkpoints.length - 1} aria-label="move down" onClick={() => edit((d) => { const a = d.rules.hunt.checkpoints; [a[i + 1], a[i]] = [a[i]!, a[i + 1]!]; })}>↓</button>
              <button class="link danger" aria-label="delete" onClick={() => edit((d) => { d.rules.hunt.checkpoints.splice(i, 1); })}>✕</button>
            </div>
            <input placeholder="Hint shown to the wearer" value={c.hint} maxLength={500} onInput={(e) => edit((d) => { d.rules.hunt.checkpoints[i]!.hint = val(e); })} />
            <select
              class="chip-select"
              aria-label="checkpoint matching"
              value={c.matchMode ?? ''}
              onChange={(e) => edit((d) => { const v = (e.target as HTMLSelectElement).value; if (v) d.rules.hunt.checkpoints[i]!.matchMode = v as 'strict'; else delete d.rules.hunt.checkpoints[i]!.matchMode; })}
            >
              <option value="">Matching: default ({config.matchMode})</option>
              <option value="lenient">Matching: lenient</option>
              <option value="strict">Matching: strict</option>
            </select>
            <ReachNote status={reach[c.id]} ack={c.reachabilityAck} onAck={(on) => setAck(edit, 'checkpoint', c.id, reach[c.id], on)} />
          </li>
        ))}
      </ol>
      {R.hunt.checkpoints.length === 0 && <p class="muted small">Tap the map to add checkpoints in order.</p>}
      <div class="card stack" data-testid="hunt-random" style={{ padding: '10px 12px' }}>
        <label class="check">
          <input
            type="checkbox"
            checked={R.hunt.random.enabled}
            onChange={(e) => edit((d) => {
              d.rules.hunt.random.enabled = checked(e);
              if (checked(e)) {
                const n = d.rules.hunt.checkpoints.length;
                d.rules.hunt.random.max = Math.max(1, Math.min(d.rules.hunt.random.max, n || 1));
                d.rules.hunt.random.min = Math.min(d.rules.hunt.random.min, d.rules.hunt.random.max);
              }
            })}
          />
          <span>
            <strong>Random route</strong> – the checkpoints above are only <em>possible</em> checkpoints; when the hunt starts,
            Lockation draws some of them in random order. Nobody knows the route in advance – great for self-locks.
          </span>
        </label>
        {R.hunt.random.enabled && (
          <div class="grid2">
            <NumberField path="rules.hunt.random.min" label="At least" suffix="checkpoints" min={1} max={R.hunt.checkpoints.length || 1} value={R.hunt.random.min} onChange={(v) => edit((d) => { d.rules.hunt.random.min = v ?? 1; })} />
            <NumberField path="rules.hunt.random.max" label="At most" suffix="checkpoints" min={1} max={R.hunt.checkpoints.length || 1} value={R.hunt.random.max} hint={`Drawn from ${R.hunt.checkpoints.length} possible checkpoints.`} onChange={(v) => edit((d) => { d.rules.hunt.random.max = v ?? 1; })} />
          </div>
        )}
        {R.hunt.random.enabled && demo && <RedrawButton demo={demo} />}
      </div>
      <div class="grid2">
        <label class="field">
          Reveal to wearer
          <select value={R.hunt.reveal} onChange={(e) => edit((d) => { d.rules.hunt.reveal = (e.target as HTMLSelectElement).value as 'all'; })}>
            <option value="all">Hint + pin all on the map</option>
            <option value="map">Hint + pin current on the map</option>
            <option value="distance">Hint + hot/cold distance</option>
            <option value="hint">Hint only</option>
          </select>
        </label>
        <label class="field">
          Order
          <select value={R.hunt.order} onChange={(e) => edit((d) => { d.rules.hunt.order = (e.target as HTMLSelectElement).value as 'sequence'; })}>
            <option value="sequence">In order (1 → 2 → 3 …)</option>
            <option value="any">Any order</option>
          </select>
        </label>
        <label class="field">
          Start
          <select data-testid="hunt-start" value={R.hunt.start} onChange={(e) => edit((d) => { d.rules.hunt.start = (e.target as HTMLSelectElement).value as 'auto'; })}>
            <option value="auto">Automatically when the lock starts</option>
            <option value="wearer">The wearer starts it</option>
            <option value="keyholder">The keyholder starts it</option>
            <option value="scheduled">At a scheduled time</option>
          </select>
        </label>
        {R.hunt.start === 'scheduled' && (
          <>
            <label class="field">
              {`Start at (lock time zone: ${config.timezone})`}
              <input
                type="datetime-local"
                value={startAtInput(R.hunt.startAt, config.timezone)}
                onInput={(e) => {
                  const v = (e.target as HTMLInputElement).value;
                  edit((d) => {
                    d.rules.hunt.startAt = startAtValue(v, d.timezone);
                    if (v) d.rules.hunt.startAfterMinutes = undefined;
                  });
                }}
              />
            </label>
            <NumberField label="… or after the lock start" suffix="minutes" optional min={0} value={R.hunt.startAfterMinutes} onChange={(v) => edit((d) => { d.rules.hunt.startAfterMinutes = v; if (v !== undefined) d.rules.hunt.startAt = undefined; })} />
          </>
        )}
        <label class="field">
          Pause / resume
          <select value={R.hunt.pauseBy} onChange={(e) => edit((d) => { d.rules.hunt.pauseBy = (e.target as HTMLSelectElement).value as 'keyholder'; })}>
            <option value="nobody">Nobody</option>
            <option value="keyholder">Keyholder only</option>
            <option value="both">Wearer and keyholder</option>
          </select>
        </label>
        <label class="check">
          <input type="checkbox" checked={R.hunt.wearerCanAbort} onChange={(e) => edit((d) => { d.rules.hunt.wearerCanAbort = checked(e); })} />
          The wearer may give up the hunt (counts as failed)
        </label>
        {R.hunt.reveal !== 'all' && (
          <NumberField label="Wrong-guess cooldown" suffix="minutes" min={0} value={R.hunt.wrongCooldownMinutes} onChange={(v) => edit((d) => { d.rules.hunt.wrongCooldownMinutes = v ?? 0; })} />
        )}
        <NumberField label="Time limit" suffix="minutes" optional min={10} value={R.hunt.timeLimitMinutes} onChange={(v) => edit((d) => { d.rules.hunt.timeLimitMinutes = v; })} />
        <label class="check">
          <input type="checkbox" checked={R.hunt.blockUnlockUntilComplete} onChange={(e) => edit((d) => { d.rules.hunt.blockUnlockUntilComplete = checked(e); })} />
          Block unlocking until completed
        </label>
      </div>
      <p class="small muted" style={{ margin: 0 }}>
        {R.hunt.reveal === 'all'
          ? 'The wearer sees all checkpoints with hints on the map (they are also synced to OwnTracks). Wrong guesses are disabled.'
          : R.hunt.reveal === 'map'
            ? 'Only the current checkpoint is shown on the map. A "hunt guess" at the wrong place counts as a wrong turn.'
            : 'Checkpoints stay secret. A "hunt guess" at the wrong place counts as a wrong turn.'}
      </p>
      <ConsequenceEditor label="Each checkpoint found" value={R.hunt.onCheckpoint} commands={commands} onChange={(v) => edit((d) => { d.rules.hunt.onCheckpoint = v; })} />
      {R.hunt.reveal !== 'all' && (
        <ConsequenceEditor label="Wrong turn (hunt guess at the wrong place)" value={R.hunt.onWrong} commands={commands} onChange={(v) => edit((d) => { d.rules.hunt.onWrong = v; })} />
      )}
      <ConsequenceEditor label="Hunt completed" value={R.hunt.onComplete} commands={commands} onChange={(v) => edit((d) => { d.rules.hunt.onComplete = v; })} />
      {R.hunt.timeLimitMinutes && <ConsequenceEditor label="Time limit exceeded" value={R.hunt.onTimeout} commands={commands} onChange={(v) => edit((d) => { d.rules.hunt.onTimeout = v; })} />}
      {R.hunt.wearerCanAbort && <ConsequenceEditor label="Wearer gives up" value={R.hunt.onAbort} commands={commands} onChange={(v) => edit((d) => { d.rules.hunt.onAbort = v; })} />}
      <p class="small muted" style={{ margin: 0 }}>
        The keyholder can always start the hunt early and end it (without consequences). A pause stops the time limit; checkpoints don't count while paused.
      </p>
    </Section>
  );
}

/** Demo only: restart the hunt with a newly drawn random route (in a real lock the drawn route is fixed). */
function RedrawButton({ demo }: { demo: NonNullable<TabProps['demo']> }) {
  const [msg, setMsg] = useState<string>();
  const [busy, setBusy] = useState(false);
  return (
    <div class="stack" data-testid="hunt-redraw">
      <div class="row">
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const r = await demo.redrawHuntRoute();
              setMsg(r.drawn ? `New route (${r.names.length}): ${r.names.join(' → ')}` : 'Hunt reset – the route is drawn when the hunt starts.');
            } finally {
              setBusy(false);
            }
          }}
        >
          🎲 Draw a new route (demo)
        </button>
      </div>
      <span class="small muted">
        Restarts the demo hunt with a new random route, using the <strong>saved</strong> settings (save first after changes). In a
        real lock the route is drawn once and stays fixed.
      </span>
      {msg && <span class="small" data-testid="hunt-redraw-result">{msg}</span>}
    </div>
  );
}
