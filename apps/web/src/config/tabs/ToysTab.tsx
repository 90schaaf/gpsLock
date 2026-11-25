import { ConsequenceEditor } from '../editors.js';
import { Section, type TabProps } from '../shared.js';

/** F27 – toy control via XToys: on / off and the emergency-stop punishment. Toy actions are 🎮 consequences everywhere. */
export function ToysTab({ config, edit, commands }: TabProps) {
  const T = config.rules.toy;
  return (
    <Section
      title="Toy control (XToys)"
      enabled={T.enabled}
      onToggle={(v) => edit((d) => { d.rules.toy.enabled = v; })}
      help="The wearer connects their toys through XToys. Your rules then control them: add a 🎮 Toy consequence anywhere (forbidden zones, missed check-ins, surprise zones, missions, …). Nobody controls the toys by hand."
    >
      <ul class="small" style={{ margin: 0, paddingLeft: '18px' }}>
        <li>
          Toy actions target a <strong>body part</strong> (or all toys), optionally a toy type and channel: play a pattern, change the intensity (e.g. +10 % at every
          penalty), ⚡ shock (e-stim) or stop.
        </li>
        <li>The wearer's limits (maximum intensity and duration per toy) always apply – you see them on the main page once the toys are connected.</li>
        <li>Without connected toys, toy actions are skipped and logged.</li>
        <li>
          The wearer can always use the <strong>emergency stop</strong> (stop and disconnect the toys). It must cost something:
        </li>
      </ul>
      <ConsequenceEditor label="Emergency stop" value={T.onEmergencyStop} commands={commands} onChange={(v) => edit((d) => { d.rules.toy.onEmergencyStop = v; })} />
      <p class="small muted" style={{ margin: 0 }}>
        Wearers can set up and try their toys on the <a href="toys.html" target="_blank" rel="noopener">toy test page</a> before the lock.
      </p>
    </Section>
  );
}
