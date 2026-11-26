import { ConsequenceEditor, ToyEffectEditor } from '../editors.js';
import { Section, type TabProps } from '../shared.js';

/** F27 – toy control via XToys: on / off and the optional emergency-stop punishment. Toy actions are 🎮 consequences everywhere. */
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
          The wearer can always use the <strong>emergency stop</strong> (stop and disconnect the toys). Optionally, it costs something (leave empty for no consequence):
        </li>
      </ul>
      <ConsequenceEditor label="Emergency stop" value={T.onEmergencyStop} commands={commands} onChange={(v) => edit((d) => { d.rules.toy.onEmergencyStop = v; })} />
      <ToyEffectEditor
        label="Effect while outside the required zones"
        hint={config.tracking.enabled ? 'runs until the wearer is back in a required zone' : 'needs background tracking'}
        value={T.whileOutsideRequired}
        onChange={(v) => edit((d) => { d.rules.toy.whileOutsideRequired = v; })}
      />
      <p class="small muted" style={{ margin: 0 }}>
        Effects <strong>while inside</strong> a zone are set per zone in the 🗺 Zones tab. They need background tracking, run as long as the condition holds and end by
        themselves if Lockation loses contact. Tip for wearers: a maximum duration of at least 2 minutes per action keeps them running without gaps.
      </p>
      <p class="small muted" style={{ margin: 0 }}>
        Wearers can set up and try their toys on the <a href="toys.html" target="_blank" rel="noopener">toy test page</a> before the lock.
      </p>
    </Section>
  );
}
