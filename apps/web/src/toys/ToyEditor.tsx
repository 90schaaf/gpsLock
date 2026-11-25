import { BODY_PARTS, defaultToy, TOY_TYPE_IDS, TOY_TYPES, type Toy, type ToyType } from '@lockation/core';

/** One toy of the wearer's setup: name, type, body part and the wearer's limits. */
export function ToyEditor({ toy, slot, onChange, onRemove }: { toy: Toy; slot: string; onChange: (fn: (t: Toy) => void) => void; onRemove: () => void }) {
  const chans = TOY_TYPES[toy.type].channels;
  return (
    <div class="card stack" style={{ padding: '10px 12px' }} data-testid="toy-item">
      <div class="row">
        <input class="grow" value={toy.name} maxLength={40} aria-label="toy name" onInput={(e) => onChange((t) => { t.name = (e.target as HTMLInputElement).value; })} />
        <button class="link danger" aria-label="remove toy" onClick={onRemove}>✕</button>
      </div>
      <div class="grid2">
        <label class="field">
          Type
          <select
            value={toy.type}
            onChange={(e) =>
              onChange((t) => {
                const type = (e.target as HTMLSelectElement).value as ToyType;
                const d = defaultToy(type, t.id, t.name);
                t.type = type;
                t.maxIntensity = d.maxIntensity;
              })
            }
          >
            {TOY_TYPE_IDS.map((id) => (
              <option key={id} value={id}>{TOY_TYPES[id].label}</option>
            ))}
          </select>
        </label>
        <label class="field">
          Body part
          <select value={toy.bodyPart} onChange={(e) => onChange((t) => { t.bodyPart = (e.target as HTMLSelectElement).value as Toy['bodyPart']; })}>
            {BODY_PARTS.map((b) => (
              <option key={b} value={b}>{b}</option>
            ))}
          </select>
        </label>
        {chans.map((c, i) => (
          <label class="field" key={c}>
            Max intensity{chans.length > 1 ? ` – channel ${c}` : ''}: {toy.maxIntensity[i]} %
            <input type="range" min={0} max={100} step={5} value={toy.maxIntensity[i]} onInput={(e) => onChange((t) => { t.maxIntensity[i] = Number((e.target as HTMLInputElement).value); })} />
          </label>
        ))}
        <label class="field">
          Max duration of one action (seconds)
          <input type="number" min={1} max={3600} value={toy.maxSeconds} onInput={(e) => onChange((t) => { t.maxSeconds = Math.max(1, Math.min(3600, Number((e.target as HTMLInputElement).value) || 1)); })} />
        </label>
      </div>
      {slot && <span class="small muted">XToys slot: {slot}</span>}
    </div>
  );
}
