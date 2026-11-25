import { describe, expect, it } from 'vitest';
import { buildXToysScript, defaultToy, ToyCommandError, toyCommand, ToySetupSchema, toySlots, type ToySetup, type ToyWebhookBody } from '../src/index.js';

const setup: ToySetup = ToySetupSchema.parse({
  toys: [
    { ...defaultToy('estim', 'stim', 'E-stim box'), bodyPart: 'genitals', maxIntensity: [40, 30] },
    defaultToy('vibrator', 'vibe', 'Bullet'),
    { ...defaultToy('dual_vibrator', 'duo', 'Rabbit'), bodyPart: 'anal', maxIntensity: [80, 100], maxSeconds: 60 },
    defaultToy('vibrator', 'vibe2', 'Nipple vibe'),
  ],
});

/** Runs the generated trigger code like XToys would: trigger variables in, recorded actions out. */
function xtoys(script = buildXToysScript(setup)) {
  const vars: Record<string, string> = {};
  const calls: any[] = [];
  const code = (action: string) => (script.globalTriggers.find((t) => t.action === action)!.actions[0] as { code: string }).code;
  const run = (action: string, body: Record<string, string>, connected: Record<string, unknown[]> = {}) => {
    const scope: Record<string, string> = { ...vars };
    for (const [k, v] of Object.entries(body)) if (k !== 'action') scope[`trigger-${k}`] = v;
    calls.length = 0;
    const fn = new Function('getVariable', 'setVariable', 'callAction', 'getConnectedBlocks', code(action));
    fn(
      (k: string) => scope[k],
      (k: string, v: string) => {
        vars[k] = v;
        scope[k] = v;
      },
      (a: unknown) => calls.push(a),
      () => connected,
    );
    return [...calls];
  };
  return { run, vars };
}

describe('toy setup', () => {
  it('validates channels per type and unique ids', () => {
    expect(ToySetupSchema.safeParse({ toys: [{ ...defaultToy('estim', 'a'), maxIntensity: [50] }] }).success).toBe(false);
    expect(ToySetupSchema.safeParse({ toys: [defaultToy('vibrator', 'a'), defaultToy('estim', 'a')] }).success).toBe(false);
    expect(ToySetupSchema.safeParse({ toys: Array.from({ length: 9 }, (_, i) => defaultToy('vibrator', `t${i}`)) }).success).toBe(false);
    expect(defaultToy('estim', 'x').maxIntensity).toEqual([40, 40]);
  });

  it('gives each toy its own XToys slot (letters per type)', () => {
    expect(toySlots(setup)).toEqual({ stim: 'part-estim|part-estim-a', vibe: 'part-vibrator-a', duo: 'part-vibrator|part-vibrator-a', vibe2: 'part-vibrator-b' });
  });
});

describe('commands', () => {
  it('clamps to the wearer limits and maps channels', () => {
    expect(toyCommand(setup, 'stim', { cmd: 'play', shape: 'pulse', intensity: 90, seconds: 30, channel: 'B' })).toEqual({
      action: 'lockation', cmd: 'play', slot: 'part-estim|part-estim-a', ch: '2', shape: 'pulse', level: '30', seconds: '30',
    });
    expect(toyCommand(setup, 'stim', { cmd: 'play', shape: 'constant', intensity: 90, seconds: 10 }).level).toBe('30'); // both channels → lower cap
    expect(toyCommand(setup, 'duo', { cmd: 'play', shape: 'wave', intensity: 50, seconds: 999 }).seconds).toBe('60');
    expect(toyCommand(setup, 'vibe', { cmd: 'intensity', delta: 10 })).toMatchObject({ cmd: 'intensity', delta: '10', ch: 'all' });
    expect(toyCommand(setup, 'all', { cmd: 'stop' })).toEqual({ action: 'lockation', cmd: 'stopAll' });
  });

  it('rejects impossible commands', () => {
    expect(() => toyCommand(setup, 'vibe', { cmd: 'shock', intensity: 10, seconds: 1 })).toThrow(ToyCommandError);
    expect(() => toyCommand(setup, 'vibe', { cmd: 'play', shape: 'pulse', intensity: 10, seconds: 1, channel: 'B' })).not.toThrow(); // 1-channel: channel ignored
    expect(() => toyCommand(setup, 'duo', { cmd: 'play', shape: 'pulse', intensity: 10, seconds: 1, channel: 'X' })).toThrow(ToyCommandError);
    expect(() => toyCommand(setup, 'nope', { cmd: 'stop' })).toThrow(ToyCommandError);
    expect(() => toyCommand(setup, 'all', { cmd: 'intensity', delta: 5 })).toThrow(ToyCommandError);
  });
});

describe('generated XToys script', () => {
  it('has the webhook block, one slot per toy with caps, and stops everything at the end', () => {
    const s = buildXToysScript(setup);
    expect(s.channels['local-webhook-a']).toMatchObject({ type: 'local-webhook', outbound: true });
    expect(s.channels['part-estim|part-estim-a']).toEqual({ type: 'part-estim|part-estim', name: 'E-stim box (genitals)' });
    expect(s.initialActions).toContainEqual({ type: 'updateComponent', channel: 'part-estim|part-estim-a', action: 'setMaximum', actionChannel: '2', percentVolume: '30' });
    expect(s.initialActions).toContainEqual({ type: 'updateComponent', channel: 'part-vibrator-a', action: 'setMaximum', actionChannel: 'all', percentVolume: '100' });
    expect(s.finalActions).toHaveLength(2 + 1 + 2 + 1);
    expect(s.globalTriggers.map((t) => t.action)).toEqual(['lockation', 'getToys']);
  });

  it('is plain ES5 (XToys runs an ES5 interpreter)', () => {
    for (const t of buildXToysScript(setup).globalTriggers) {
      const code = (t.actions[0] as { code: string }).code;
      expect(code).not.toMatch(/=>|\blet\b|\bconst\b|`/);
    }
  });

  it('play: sets the level and a non-looping pattern that ends at 0 (stops by itself)', () => {
    const x = xtoys();
    const calls = x.run('lockation', toyCommand(setup, 'stim', { cmd: 'play', shape: 'pulse', intensity: 25, seconds: 3, channel: 'A' }));
    expect(calls[0]).toEqual({ type: 'updateComponent', channel: 'part-estim|part-estim-a', action: 'setVolume', actionChannel: '1', rampTime: '0', percentVolume: '25' });
    const pat = calls[1];
    expect(pat).toMatchObject({ action: 'setPattern', actionChannel: '1', pattern: { loop: false, length: '3', type: 'draw' } });
    const pts = pat.pattern.patternData.channelData['1'];
    expect(pts[0]).toEqual({ at: 0, pos: 100 });
    expect(pts.at(-1)).toEqual({ at: 3000, pos: 0 });
    expect(x.vars['lv-part-estim|part-estim-a-1']).toBe('25');
  });

  it('enforces the caps again inside XToys and supports relative intensity changes', () => {
    const x = xtoys();
    const forged: ToyWebhookBody = { action: 'lockation', cmd: 'play', slot: 'part-vibrator|part-vibrator-a', ch: '1', shape: 'constant', level: '100', seconds: '10' };
    expect(x.run('lockation', forged)[0].percentVolume).toBe('80');
    expect(x.run('lockation', toyCommand(setup, 'duo', { cmd: 'intensity', delta: -30, channel: 'A' }))[0].percentVolume).toBe('50');
    expect(x.run('lockation', toyCommand(setup, 'duo', { cmd: 'intensity', delta: 100, channel: 'A' }))[0].percentVolume).toBe('80');
  });

  it('both channels, shock, stop and stop all', () => {
    const x = xtoys();
    expect(x.run('lockation', toyCommand(setup, 'duo', { cmd: 'play', shape: 'wave', intensity: 50, seconds: 2 })).filter((c) => c.action === 'setPattern').map((c) => c.actionChannel)).toEqual(['1', '2']);
    expect(x.run('lockation', toyCommand(setup, 'stim', { cmd: 'shock', intensity: 90, seconds: 2, channel: 'B' }))).toEqual([
      { type: 'updateComponent', channel: 'part-estim|part-estim-a', action: 'setShock2', actionChannel: '2', percentVolume: '30', time: '2', shock: true },
    ]);
    expect(x.run('lockation', toyCommand(setup, 'vibe', { cmd: 'stop' }))).toEqual([{ type: 'updateComponent', channel: 'part-vibrator-a', action: 'setVolume', actionChannel: 'all', rampTime: '0', percentVolume: '0' }]);
    expect(x.run('lockation', toyCommand(setup, 'all', { cmd: 'stop' }))).toHaveLength(6);
    expect(x.run('lockation', { action: 'lockation', cmd: 'play', slot: 'unknown', ch: 'all', shape: 'pulse', level: '50', seconds: '5' })).toEqual([]);
  });

  it('getToys reports the connected toys per slot back over the webhook', () => {
    const x = xtoys();
    const calls = x.run('getToys', {}, { 'part-vibrator-a': [{ blockName: 'Lovense Lush', channelName: 'vibrate' }] });
    expect(calls[0]).toMatchObject({ action: 'send', format: 'raw', webhookAction: 'getToys' });
    expect(calls[0].webhookData['part-vibrator-a']).toEqual([{ name: 'Lovense Lush', channel: 'vibrate' }]);
    expect(calls[0].webhookData['part-estim|part-estim-a']).toEqual([]);
  });
});
