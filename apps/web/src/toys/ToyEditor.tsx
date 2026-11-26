import { BODY_PARTS, TOY_TYPE_IDS, TOY_TYPES, type Toy, type ToyType } from '@lockation/core';

/** One toy of the wearer's setup: name, type and body part (limits are set in XToys). */
export function ToyEditor({ toy, slot, onChange, onRemove }: { toy: Toy; slot: string; onChange: (fn: (t: Toy) => void) => void; onRemove: () => void }) {
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
                t.type = (e.target as HTMLSelectElement).value as ToyType;
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
      </div>
      {slot && <span class="small muted">XToys slot: {slot}</span>}
    </div>
  );
}
