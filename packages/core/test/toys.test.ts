import { describe, expect, it } from 'vitest';
import { desiredToyEffects, initialState, nextDueAt, pauseToyEffects, reconcileToyEffects, refreshAfterMs, buildXToysScript, ConsequenceSchema, defaultToy, describeConsequence, parseConfig, resolveToyConsequence, TOY_COMMENTS, ToyCommandError, toyCommand, toyComment, ToySetupSchema, toySlots, type ToyConsequence, type ToySetup, type ToyWebhookBody } from '../src/index.js';

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
  const action_ = (action: string) => (script.globalTriggers.find((t) => t.action === action)!.actions as { type: string; code?: string; variables?: { name: string; value: string }[] }[]).find((a) => a.type === 'customCode')!;
  let text = '';
  const run = (action: string, body: Record<string, string>, connected: Record<string, unknown[]> = {}) => {
    const scope: Record<string, string> = { ...vars };
    for (const [k, v] of Object.entries(body)) if (k !== 'action') scope[`trigger-${k}`] = v;
    calls.length = 0;
    const a = action_(action);
    const injected = a.variables ?? [];
    // Like XToys: a key that was not sent stays unresolved ("trigger-<key>").
    const values = injected.map((v) => scope[v.value] ?? v.value);
    const fn = new Function('getVariable', 'setVariable', 'callAction', 'getConnectedBlocks', ...injected.map((v) => v.name), a.code!);
    fn(
      (k: string) => scope[k],
      (k: string, v: string) => {
        vars[k] = v;
        scope[k] = v;
      },
      (a: any) => (a.type === 'updateScript' ? (text = a.text) : calls.push(a)),
      () => connected,
      ...values,
    );
    return [...calls];
  };
  return { run, vars, text: () => text };
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

describe('rotators', () => {
  const rot: ToySetup = { version: 1, toys: [defaultToy('vibe_rotator', 'rab', 'Rabbit'), defaultToy('rotator', 'spin', 'Spinner')] };
  it('uses the XToys types part-vibrator|part-rotator and part-rotator', () => {
    expect(toySlots(rot)).toEqual({ rab: 'part-vibrator|part-rotator-a', spin: 'part-rotator-a' });
    const s = buildXToysScript(rot);
    expect((s.channels as Record<string, { type: string }>)['part-vibrator|part-rotator-a']!.type).toBe('part-vibrator|part-rotator');
    expect((s.channels as Record<string, { type: string }>)['part-rotator-a']!.type).toBe('part-rotator');
  });
  it('maps vibration / rotation to XToys channels 1 / 2', () => {
    expect(toyCommand(rot, 'rab', { cmd: 'intensity', intensity: 30, channel: 'rotation' }).ch).toBe('2');
    expect(toyCommand(rot, 'rab', { cmd: 'intensity', intensity: 30, channel: 'vibration' }).ch).toBe('1');
    expect(toyCommand(rot, 'spin', { cmd: 'intensity', intensity: 30 }).ch).toBe('all');
    const c = { type: 'toy', action: 'play', target: { bodyPart: 'all', toyType: 'vibe_rotator', channel: 'rotation' }, intensity: 50, seconds: 10 } as ToyConsequence;
    expect(resolveToyConsequence(rot.toys, c).map((r) => [r.toy.id, r.body.ch])).toEqual([['rab', '2']]);
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
    expect(s.channels['webhook-a']).toMatchObject({ type: 'webhook', outbound: true });
    expect(s.channels['part-estim|part-estim-a']).toEqual({ type: 'part-estim|part-estim', name: 'E-stim box (genitals)' });
    expect(s.initialActions).toContainEqual({ type: 'updateComponent', channel: 'part-estim|part-estim-a', action: 'setMaximum', actionChannel: '2', percentVolume: '30' });
    expect(s.initialActions).toContainEqual({ type: 'updateComponent', channel: 'part-vibrator-a', action: 'setMaximum', actionChannel: 'all', percentVolume: '100' });
    expect(s.finalActions).toHaveLength(2 + 1 + 2 + 1);
    expect(s.globalTriggers.map((t) => t.action)).toEqual(['lockation', 'getToys']);
  });

  it('is plain ES5 (XToys runs an ES5 interpreter)', () => {
    for (const t of buildXToysScript(setup).globalTriggers) {
      for (const a of t.actions as { type: string; code?: string }[]) if (a.code) expect(a.code).not.toMatch(/=>|\blet\b|\bconst\b|`/);
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

describe('debugging aids in the script', () => {
  it('shows the received values first (no JavaScript), then the result', () => {
    const lock = buildXToysScript(setup).globalTriggers.find((t) => t.action === 'lockation')!;
    expect(lock.actions[0]).toEqual({ type: 'updateScript', action: 'setText', text: 'Lockation received: {trigger-cmd} {trigger-slot} ch {trigger-ch} level {trigger-level}' });
    const x = xtoys();
    x.run('lockation', toyCommand(setup, 'vibe', { cmd: 'play', shape: 'pulse', intensity: 40, seconds: 5 }));
    expect(x.text()).toBe('Lockation: play part-vibrator-a ch all level 40 delta - pulse 5s');
    x.run('lockation', { action: 'lockation', cmd: 'play', slot: 'part-vibrator-z', ch: 'all' });
    expect(x.text()).toMatch(/unknown slot "part-vibrator-z"/);
  });

  it('reports JavaScript errors on the script screen instead of failing silently', () => {
    const lock = buildXToysScript(setup).globalTriggers.find((t) => t.action === 'lockation')!;
    const act = (lock.actions as { type: string; code?: string; variables?: { name: string; value: string }[] }[]).find((a) => a.code)!;
    let text = '';
    const scope: Record<string, string> = { 'trigger-cmd': 'play', 'trigger-slot': 'part-vibrator-a', 'trigger-ch': 'all', 'trigger-level': '10', 'trigger-seconds': '2' };
    new Function('getVariable', 'setVariable', 'callAction', ...act.variables!.map((v) => v.name), act.code!)(
      (k: string) => scope[k],
      () => undefined,
      (a: any) => {
        if (a.type === 'updateScript') text = a.text;
        else if (a.action === 'setPattern') throw new Error('unknown action setPattern');
      },
      ...act.variables!.map((v) => scope[v.value] ?? v.value),
    );
    expect(text).toBe('Lockation: ERROR in play: unknown action setPattern');
  });

});

describe('cloud webhook block', () => {
  it('uses the "webhook" block (cloud), not "local-webhook" (LAN only), and injects the keys as variables', () => {
    const s = buildXToysScript(setup);
    expect(s.channels['webhook-a']).toEqual({ type: 'webhook', outbound: true, hideWebhookInfo: false });
    expect(Object.values(s.channels).some((c: any) => c.type === 'local-webhook')).toBe(false);
    const lock = s.globalTriggers.find((t) => t.action === 'lockation')!;
    expect(lock.channel).toBe('webhook-a');
    const act = (lock.actions as any[]).find((a) => a.type === 'customCode');
    expect(act.variables).toContainEqual({ name: 't_level', value: 'trigger-level', expression: null });
    expect(act.variables.map((v: any) => v.name)).toEqual(['t_cmd', 't_slot', 't_ch', 't_shape', 't_level', 't_delta', 't_seconds']);
  });

  it('treats keys that were not sent (unresolved "trigger-…") as missing', () => {
    const x = xtoys();
    x.run('lockation', toyCommand(setup, 'duo', { cmd: 'play', shape: 'constant', intensity: 60, seconds: 5, channel: 'A' }));
    // "intensity" without delta: t_delta arrives as "trigger-delta" → absolute level is used
    expect(x.run('lockation', toyCommand(setup, 'duo', { cmd: 'intensity', intensity: 30, channel: 'A' }))[0].percentVolume).toBe('30');
  });
});

describe('toy consequences (step 2)', () => {
  const toys = setup.toys;
  const c = (x: Record<string, unknown>) => ({ type: 'toy' as const, action: 'play' as const, target: { bodyPart: 'all' }, ...x }) as ToyConsequence;

  it('targets toys by body part, type and channel, clamped to each toy', () => {
    expect(resolveToyConsequence(toys, c({ target: { bodyPart: 'all' }, intensity: 90, seconds: 20 })).map((r) => [r.toy.id, r.body.level])).toEqual([
      ['stim', '30'],
      ['vibe', '90'],
      ['duo', '80'],
      ['vibe2', '90'],
    ]);
    expect(resolveToyConsequence(toys, c({ target: { bodyPart: 'anal' } })).map((r) => r.toy.id)).toEqual(['duo']);
    expect(resolveToyConsequence(toys, c({ target: { bodyPart: 'all', toyType: 'vibrator' } })).map((r) => r.toy.id)).toEqual(['vibe', 'vibe2']);
    const chB = resolveToyConsequence(toys, c({ target: { bodyPart: 'all', channel: 'B' } }));
    expect(chB.map((r) => [r.toy.id, r.body.ch])).toEqual([
      ['stim', '2'],
      ['vibe', 'all'],
      ['duo', '2'],
      ['vibe2', 'all'],
    ]);
    expect(resolveToyConsequence(toys, c({ action: 'shock', intensity: 50 })).map((r) => r.toy.id)).toEqual(['stim']);
    expect(resolveToyConsequence(toys, c({ action: 'intensity', delta: 10, target: { bodyPart: 'genitals', toyType: 'estim' } }))[0]!.body).toMatchObject({ cmd: 'intensity', delta: '10' });
    expect(resolveToyConsequence([], c({}))).toEqual([]);
  });

  it('describes toy actions and picks a stable cheeky comment', () => {
    expect(describeConsequence(c({ shape: 'wave', intensity: 60, seconds: 90, target: { bodyPart: 'genitals' } }))).toBe('🎮 wave 60 % for 1m (toys – genitals)');
    expect(describeConsequence(c({ action: 'intensity', delta: -20, target: { bodyPart: 'all', toyType: 'estim', channel: 'A' } }))).toBe('🎮 intensity -20 % (e-stim (2 channels) A)');
    expect(describeConsequence(c({ action: 'stop' }))).toBe('🎮 stop (toys)');
    expect(toyComment('s1:abc:0')).toBe(toyComment('s1:abc:0'));
    expect(TOY_COMMENTS).toContain(toyComment('anything'));
  });

  it('validation: toy control needs a (non-toy) emergency-stop punishment', () => {
    expect(parseConfig({ version: 2, rules: { toy: { enabled: true } } }).ok).toBe(false);
    expect(parseConfig({ version: 2, rules: { toy: { enabled: true, onEmergencyStop: [c({})] } } }).ok).toBe(false);
    expect(parseConfig({ version: 2, rules: { toy: { enabled: true, onEmergencyStop: [{ type: 'add_time', seconds: 7200 }] } } }).ok).toBe(true);
    expect(ConsequenceSchema.safeParse(c({ shape: 'zigzag' })).success).toBe(false);
  });
});

describe('effects while a condition holds (step 3)', () => {
  const toys = setup.toys; // stim (estim, max 40/30), vibe, duo (max 80/100, 60 s), vibe2
  const T0 = new Date('2026-06-01T10:00:00Z');
  const sec = (s: number) => new Date(T0.getTime() + s * 1000);
  const eff = (x: Record<string, unknown> = {}) => ({ target: { bodyPart: 'all' }, shape: 'wave' as const, intensity: 50, ...x }) as any;
  const d = (source: string, e = eff()) => ({ source, label: `while in "${source}"`, effect: e });

  it('renews a minute before the self-ending pattern runs out (at least halfway)', () => {
    expect(refreshAfterMs(300)).toBe(240_000);
    expect(refreshAfterMs(60)).toBe(30_000);
    expect(refreshAfterMs(10)).toBe(5_000);
  });

  it('starts, keeps, renews and stops an effect', () => {
    const only = [toys[1]!]; // vibe: max 100 %, 300 s
    const a = reconcileToyEffects(only, [d('zone:bar')], {}, T0);
    expect(a.commands.map((c) => c.body)).toEqual([{ action: 'lockation', slot: 'part-vibrator-a', ch: 'all', cmd: 'play', shape: 'wave', level: '50', seconds: '300' }]);
    expect(a.running['vibe:all']).toMatchObject({ source: 'zone:bar', level: 50, refreshAt: sec(240).toISOString() });
    expect(reconcileToyEffects(only, [d('zone:bar')], a.running, sec(100)).commands).toEqual([]);
    const renewed = reconcileToyEffects(only, [d('zone:bar')], a.running, sec(241));
    expect(renewed.commands).toHaveLength(1);
    const stopped = reconcileToyEffects(only, [], renewed.running, sec(300));
    expect(stopped.commands.map((c) => c.body.cmd)).toEqual(['stop']);
    expect(stopped.running).toEqual({});
  });

  it('the higher intensity wins on the same toy; channels are separate', () => {
    const r = reconcileToyEffects(toys, [d('zone:a', eff({ intensity: 20 })), d('zone:b', eff({ intensity: 70, target: { bodyPart: 'genitals', toyType: 'estim', channel: 'A' } }))], {}, T0);
    expect(r.running['vibe:all']).toMatchObject({ source: 'zone:a', level: 20 });
    expect(r.running['stim:A']).toMatchObject({ source: 'zone:b', level: 40 }); // stored as sent: clamped to channel A's 40 %
    expect(r.commands.find((c) => c.toy.id === 'stim' && c.body.ch === '1')!.body.level).toBe('40'); // clamped to the toy
    const both = reconcileToyEffects([toys[1]!], [d('zone:a', eff({ intensity: 20 })), d('zone:b', eff({ intensity: 70 }))], {}, T0);
    expect(both.running['vibe:all']).toMatchObject({ source: 'zone:b', level: 70 });
  });

  it('a one-off action pauses the effect; it resumes afterwards', () => {
    const only = [toys[1]!];
    const a = reconcileToyEffects(only, [d('zone:bar')], {}, T0);
    const paused = pauseToyEffects(a.running, ['vibe'], sec(30));
    expect(reconcileToyEffects(only, [d('zone:bar')], paused, sec(10)).commands).toEqual([]);
    const resumed = reconcileToyEffects(only, [d('zone:bar')], paused, sec(31));
    expect(resumed.commands.map((c) => c.body.cmd)).toEqual(['play']);
    expect(resumed.running['vibe:all']!.resumeAt).toBeUndefined();
  });
});

describe('effects in the engine and config', () => {
  const cfgWith = (extra: Record<string, unknown>) =>
    parseConfig({
      version: 2,
      timezone: 'Europe/Zurich',
      zones: [{ id: 'bar', name: 'Bar', lat: 47.39, lng: 8.515, radiusM: 100, toy: { whileInside: { target: { bodyPart: 'all' }, shape: 'pulse', intensity: 40 } } }],
      rules: { toy: { enabled: true, onEmergencyStop: [{ type: 'add_time', seconds: 60 }] } },
      ...extra,
    });

  it('"while inside" needs background tracking', () => {
    expect(cfgWith({}).ok).toBe(false);
    expect(cfgWith({ tracking: { enabled: true } }).ok).toBe(true);
  });

  it('desired effects follow the presence; running effects are due for renewal', () => {
    const r = cfgWith({ tracking: { enabled: true } });
    if (!r.ok) throw new Error('config');
    const T0 = new Date('2026-06-01T10:00:00Z');
    const state = initialState(r.config, T0);
    expect(desiredToyEffects(r.config, state)).toEqual([]);
    state.presence.bar = { since: T0.toISOString(), lastSeen: T0.toISOString() };
    expect(desiredToyEffects(r.config, state)).toEqual([{ source: 'zone:bar', label: 'while in "Bar"', effect: { target: { bodyPart: 'all' }, shape: 'pulse', intensity: 40 } }]);
    state.toy.running = { 'vibe:all': { source: 'zone:bar', label: 'x', shape: 'pulse', level: 40, sentAt: T0.toISOString(), refreshAt: '2026-06-01T10:04:00.000Z' } };
    expect(nextDueAt(r.config, state, T0)!.toISOString() <= '2026-06-01T10:04:00.000Z').toBe(true);
  });
});
