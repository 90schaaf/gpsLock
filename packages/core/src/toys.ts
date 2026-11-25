/**
 * F27 – toys via XToys: toy model, webhook commands and the generated Lockation XToys script (proxy).
 *
 * The script is generated from the wearer's toy list: one XToys output slot per toy, one webhook trigger (`lockation`)
 * whose JavaScript dispatches each command to the slot / channel named in the request. Timed actions are non-looping
 * patterns that end at 0, so a toy stops by itself even if no `stop` arrives (dead-man's switch on the toy side).
 * Format reference: `examples/xtoys/local webhook.json` (official XToys export).
 */
import { z } from 'zod';

export const TOY_TYPES = {
  vibrator: { label: 'Vibrator (1 motor)', xtoys: 'part-vibrator', channels: ['main'], shock: false },
  dual_vibrator: { label: 'Vibrator (2 motors)', xtoys: 'part-vibrator|part-vibrator', channels: ['A', 'B'], shock: false },
  estim: { label: 'E-stim (2 channels)', xtoys: 'part-estim|part-estim', channels: ['A', 'B'], shock: true },
} as const;
export type ToyType = keyof typeof TOY_TYPES;
export const TOY_TYPE_IDS = Object.keys(TOY_TYPES) as ToyType[];

export const BODY_PARTS = ['genitals', 'anal', 'nipples', 'other'] as const;
export type BodyPart = (typeof BODY_PARTS)[number];

export const MAX_TOYS = 8;
export const MAX_TOY_SECONDS = 3600;
export const TOY_SHAPES = ['constant', 'pulse', 'wave', 'ramp'] as const;
export type ToyShape = (typeof TOY_SHAPES)[number];

const percent = z.number().int().min(0).max(100);

export const ToySchema = z
  .object({
    id: z.string().regex(/^[a-z0-9]{1,12}$/, 'lowercase letters and digits only'),
    name: z.string().min(1).max(40),
    type: z.enum(TOY_TYPE_IDS as [ToyType, ...ToyType[]]),
    bodyPart: z.enum(BODY_PARTS),
    /** Wearer limit per channel (same order as `TOY_TYPES[type].channels`). */
    maxIntensity: z.array(percent).min(1).max(2),
    /** Wearer limit for one action. */
    maxSeconds: z.number().int().min(1).max(MAX_TOY_SECONDS),
  })
  .superRefine((t, ctx) => {
    if (t.maxIntensity.length !== TOY_TYPES[t.type].channels.length) {
      ctx.addIssue({ code: 'custom', path: ['maxIntensity'], message: `${TOY_TYPES[t.type].label} has ${TOY_TYPES[t.type].channels.length} channel(s)` });
    }
  });
export type Toy = z.infer<typeof ToySchema>;

export const ToySetupSchema = z
  .object({ version: z.literal(1).default(1), toys: z.array(ToySchema).max(MAX_TOYS).default([]) })
  .superRefine((s, ctx) => {
    const ids = new Set<string>();
    s.toys.forEach((t, i) => {
      if (ids.has(t.id)) ctx.addIssue({ code: 'custom', path: ['toys', i, 'id'], message: `duplicate toy id "${t.id}"` });
      ids.add(t.id);
    });
  });
export type ToySetup = z.infer<typeof ToySetupSchema>;

/** Suggested limits for a new toy (lower for e-stim). */
export function defaultToy(type: ToyType, id: string, name: string = TOY_TYPES[type].label): Toy {
  const n = TOY_TYPES[type].channels.length;
  return { id, name, type, bodyPart: 'genitals', maxIntensity: Array(n).fill(type === 'estim' ? 40 : 100), maxSeconds: 300 };
}

/** XToys channel key per toy, e.g. `part-estim|part-estim-a` (letters a–h per XToys type, in list order). */
export function toySlots(setup: ToySetup): Record<string, string> {
  const used: Record<string, number> = {};
  const out: Record<string, string> = {};
  for (const t of setup.toys) {
    const x = TOY_TYPES[t.type].xtoys;
    const n = used[x] ?? 0;
    used[x] = n + 1;
    out[t.id] = `${x}-${'abcdefgh'[n]}`;
  }
  return out;
}

// ---------- commands (Lockation → XToys webhook) ----------

export type ToyCommandInput =
  | { cmd: 'play'; shape: ToyShape; intensity: number; seconds: number; channel?: string }
  | { cmd: 'intensity'; intensity?: number; delta?: number; channel?: string }
  | { cmd: 'shock'; intensity: number; seconds: number; channel?: string }
  | { cmd: 'stop'; channel?: string };

/** Body of `POST https://webhook.xtoys.app/<webhookId>`. Values are strings (XToys trigger variables). */
export type ToyWebhookBody = Record<string, string> & { action: 'lockation'; cmd: string };

export class ToyCommandError extends Error {}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(v)));

/** XToys `actionChannel` for a channel name: "1" / "2" / "all". */
function actionChannel(toy: Toy, channel: string | undefined): string {
  const chans = TOY_TYPES[toy.type].channels as readonly string[];
  if (!channel || channel === 'all' || chans.length === 1) return 'all';
  const i = chans.indexOf(channel);
  if (i < 0) throw new ToyCommandError(`"${toy.name}" has no channel ${channel}`);
  return String(i + 1);
}

/** Highest intensity allowed on the addressed channel(s). */
function maxFor(toy: Toy, ch: string): number {
  return ch === 'all' ? Math.min(...toy.maxIntensity) : toy.maxIntensity[Number(ch) - 1]!;
}

/** Build the webhook body for one command, clamped to the toy's limits. Throws `ToyCommandError` on invalid input. */
export function toyCommand(setup: ToySetup, toyId: 'all' | string, input: ToyCommandInput): ToyWebhookBody {
  if (toyId === 'all') {
    if (input.cmd !== 'stop') throw new ToyCommandError('Only "stop" can address all toys at once.');
    return { action: 'lockation', cmd: 'stopAll' };
  }
  const toy = setup.toys.find((t) => t.id === toyId);
  if (!toy) throw new ToyCommandError(`Unknown toy "${toyId}".`);
  const slot = toySlots(setup)[toy.id]!;
  const ch = actionChannel(toy, input.channel);
  const max = maxFor(toy, ch);
  const base = { action: 'lockation' as const, slot, ch };
  switch (input.cmd) {
    case 'play':
      return { ...base, cmd: 'play', shape: input.shape, level: String(clamp(input.intensity, 0, max)), seconds: String(clamp(input.seconds, 1, toy.maxSeconds)) };
    case 'intensity':
      if (input.intensity === undefined && input.delta === undefined) throw new ToyCommandError('Give an intensity or a change.');
      return input.intensity !== undefined ? { ...base, cmd: 'intensity', level: String(clamp(input.intensity, 0, max)) } : { ...base, cmd: 'intensity', delta: String(clamp(input.delta!, -100, 100)) };
    case 'shock':
      if (!TOY_TYPES[toy.type].shock) throw new ToyCommandError(`"${toy.name}" cannot shock.`);
      return { ...base, cmd: 'shock', level: String(clamp(input.intensity, 0, max)), seconds: String(clamp(input.seconds, 1, Math.min(10, toy.maxSeconds))) };
    case 'stop':
      return { ...base, cmd: 'stop' };
  }
}

export const xtoysWebhookUrl = (webhookId: string) => `https://webhook.xtoys.app/${encodeURIComponent(webhookId.trim())}`;
export const xtoysWebsocketUrl = (webhookId: string) => `wss://webhook.xtoys.app/${encodeURIComponent(webhookId.trim())}`;

// ---------- the generated XToys script ----------

/**
 * The cloud webhook block (`webhook`, reached via https://webhook.xtoys.app/<id>). Not `local-webhook` – that one only
 * listens on the phone's local network. Reference: the Bondage Club XToys integration's script.
 */
const WEBHOOK = 'webhook-a';

/** Webhook keys passed into the JavaScript (XToys injects them via the action's `variables` list as `t_<key>`). */
export const TOY_WEBHOOK_KEYS = ['cmd', 'slot', 'ch', 'shape', 'level', 'delta', 'seconds'] as const;
const injected = (keys: readonly string[]) => keys.map((k) => ({ name: `t_${k}`, value: `trigger-${k}`, expression: null }));

/**
 * ES5 JavaScript of the `lockation` webhook trigger (runs inside XToys' JS interpreter). `SLOTS` is injected:
 * slot → { channels, max: [per channel] }. Levels are remembered per slot / channel for relative changes.
 */
function proxyCode(slots: Record<string, { channels: number; max: number[] }>): string {
  return `// Lockation proxy – generated, do not edit (re-download it from the Lockation toy page instead).
var SLOTS = ${JSON.stringify(slots)};
var TV = { ${TOY_WEBHOOK_KEYS.map((k) => `${k}: typeof t_${k} === 'undefined' ? undefined : t_${k}`).join(', ')} };
// A key that was not sent may arrive empty or as the unresolved name ("trigger-delta" / "{trigger-delta}").
function tv(k, d) { var v = TV[k]; if (v === undefined || v === null) return d; v = String(v); return (v === '' || v.indexOf('trigger-') >= 0) ? d : v; }
function num(v, d) { var n = Number(v); return isNaN(n) ? d : n; }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, Math.round(v))); }
function chans(s, ch) { var out = []; if (ch === 'all') { for (var i = 1; i <= SLOTS[s].channels; i++) out.push(String(i)); } else out.push(ch); return out; }
function maxOf(s, c) { return SLOTS[s].max[Number(c) - 1]; }
function level(s, c) { return num(getVariable('lv-' + s + '-' + c), 0); }
function setLevel(s, c, v) {
  setVariable('lv-' + s + '-' + c, String(v));
  callAction({ type: 'updateComponent', channel: s, action: 'setVolume', actionChannel: SLOTS[s].channels > 1 ? c : 'all', rampTime: '0', percentVolume: String(v) });
}
function points(shape, seconds, from) {
  var ms = seconds * 1000, p = [], t;
  if (shape === 'pulse') { for (t = 0; t < ms; t += 1000) { p.push({ at: t, pos: 100 }); p.push({ at: Math.min(ms, t + 499), pos: 100 }); p.push({ at: Math.min(ms, t + 500), pos: 0 }); p.push({ at: Math.min(ms, t + 999), pos: 0 }); } }
  else if (shape === 'wave') { for (t = 0; t < ms; t += 100) p.push({ at: t, pos: Math.round(50 + 50 * Math.sin((t / 2000) * 2 * Math.PI - Math.PI / 2)) }); }
  else if (shape === 'ramp') { p.push({ at: 0, pos: from }); p.push({ at: ms - 1, pos: 100 }); }
  else { p.push({ at: 0, pos: 100 }); p.push({ at: ms - 1, pos: 100 }); }
  p.push({ at: ms, pos: 0 });
  return p;
}
function play(s, c, shape, lv, seconds) {
  var from = 0;
  if (shape === 'ramp') { var cur = level(s, c); from = lv > 0 ? clamp(cur / lv * 100, 0, 100) : 0; }
  setLevel(s, c, lv);
  var id = 'lockation-' + s + '-' + c + '-' + shape;
  var data = { '1': points(shape, seconds, from) };
  callAction({ type: 'updateComponent', channel: s, action: 'setPattern', actionChannel: SLOTS[s].channels > 1 ? c : 'all', patternAction: 'specific',
    pattern: { loop: false, length: String(seconds), id: id, name: 'Lockation ' + shape, channels: 1, type: 'draw', patternData: { loop: false, channels: 1, channelData: data } },
    patternControls: { id: id } });
}
// Debug: the script's text shows what happened (or the JavaScript error) – visible on the XToys script screen.
function status(msg) { callAction({ type: 'updateScript', action: 'setText', text: 'Lockation: ' + msg }); }
var cmd = String(tv('cmd', ''));
var slot = String(tv('slot', ''));
var ch = String(tv('ch', 'all'));
try {
  if (cmd === 'stopAll') {
    for (var s in SLOTS) { var cs = chans(s, 'all'); for (var i = 0; i < cs.length; i++) setLevel(s, cs[i], 0); }
    status('stop all');
  } else if (SLOTS[slot]) {
    var list = chans(slot, ch);
    for (var j = 0; j < list.length; j++) {
      var c = list[j], max = maxOf(slot, c);
      if (cmd === 'play') play(slot, c, String(tv('shape', 'constant')), clamp(num(tv('level', 0), 0), 0, max), clamp(num(tv('seconds', 10), 10), 1, ${MAX_TOY_SECONDS}));
      else if (cmd === 'intensity') {
        var d = tv('delta', null);
        setLevel(slot, c, clamp(d === null ? num(tv('level', 0), 0) : level(slot, c) + num(d, 0), 0, max));
      } else if (cmd === 'shock') callAction({ type: 'updateComponent', channel: slot, action: 'setShock2', actionChannel: c, percentVolume: String(clamp(num(tv('level', 0), 0), 0, max)), time: String(clamp(num(tv('seconds', 1), 1), 1, 10)), shock: true });
      else if (cmd === 'stop') setLevel(slot, c, 0);
    }
    status(cmd + ' ' + slot + ' ch ' + ch + ' level ' + tv('level', '-') + ' delta ' + tv('delta', '-') + ' ' + tv('shape', '') + ' ' + tv('seconds', '') + 's');
  } else status('unknown slot "' + slot + '" (cmd "' + cmd + '") – download the script again after changing the toys');
} catch (e) {
  status('ERROR in ' + cmd + ': ' + (e && e.message ? e.message : String(e)));
}
`;
}

/** Reports the connected toys per slot back over the webhook (outbound, WebSocket only). */
function getToysCode(slotNames: string[]): string {
  return `var blocks = getConnectedBlocks();
var names = ${JSON.stringify(slotNames)};
var out = {};
for (var i = 0; i < names.length; i++) {
  var raw = blocks[names[i]] || [];
  out[names[i]] = [];
  for (var j = 0; j < raw.length; j++) out[names[i]].push({ name: raw[j].blockName, channel: raw[j].channelName });
}
callAction({ type: 'updateComponent', channel: '${WEBHOOK}', action: 'send', format: 'raw', webhookAction: 'getToys', webhookData: out });
`;
}

/** The complete XToys script (export format) for this toy setup. */
export function buildXToysScript(setup: ToySetup) {
  const slots = toySlots(setup);
  const meta: Record<string, { channels: number; max: number[] }> = {};
  const channels: Record<string, unknown> = { [WEBHOOK]: { type: 'webhook', outbound: true, hideWebhookInfo: false } };
  const initialActions: unknown[] = [];
  for (const t of setup.toys) {
    const slot = slots[t.id]!;
    const n = TOY_TYPES[t.type].channels.length;
    meta[slot] = { channels: n, max: [...t.maxIntensity] };
    channels[slot] = { type: TOY_TYPES[t.type].xtoys, name: `${t.name} (${t.bodyPart})` };
    // Toy-side caps (the wearer's limits) and a quiet start.
    t.maxIntensity.forEach((max, i) => {
      const ac = n > 1 ? String(i + 1) : 'all';
      initialActions.push({ type: 'updateComponent', channel: slot, action: 'setMaximum', actionChannel: ac, percentVolume: String(max) });
      initialActions.push({ type: 'updateComponent', channel: slot, action: 'setVolume', actionChannel: ac, rampTime: '0', percentVolume: '0' });
    });
  }
  const stopAll = Object.keys(meta).flatMap((slot) =>
    Array.from({ length: meta[slot]!.channels }, (_, i) => ({ type: 'updateComponent', channel: slot, action: 'setVolume', actionChannel: meta[slot]!.channels > 1 ? String(i + 1) : 'all', rampTime: '0', percentVolume: '0' })),
  );
  return {
    initialActions,
    finalActions: stopAll,
    globalTriggers: [
      {
        type: 'componentState',
        action: 'lockation',
        channel: WEBHOOK,
        parsedAction: 'lockation',
        actions: [
          // Shown first and without JavaScript: proves the call arrived and which values XToys passed on.
          { type: 'updateScript', action: 'setText', text: 'Lockation received: {trigger-cmd} {trigger-slot} ch {trigger-ch} level {trigger-level}' },
          { type: 'customCode', code: proxyCode(meta), resultVar: 'result', variables: injected(TOY_WEBHOOK_KEYS), storeResult: false },
        ],
      },
      { type: 'componentState', action: 'getToys', channel: WEBHOOK, parsedAction: 'getToys', actions: [{ type: 'customCode', code: getToysCode(Object.keys(meta)), resultVar: 'result', variables: [], storeResult: false }] },
    ],
    jobs: { Main: { steps: { START: { actions: [] } } } },
    queues: [],
    channels,
    controls: [],
    controlPresets: [],
    media: { patterns: {}, audio: {}, voices: {} },
    customFunctions: '',
  };
}

// ---------- toy disclaimer (F27) ----------

/** Bump to ask every wearer again. */
export const TOY_DISCLAIMER_VERSION = 1;

/** Shown before connecting toys (toy test page and, later, in a lock). */
export const TOY_DISCLAIMER: readonly string[] = [
  'Lockation can start your toys at any time while they are connected – also in public, at work, on a train or in a car. Where you are is your responsibility.',
  'Never use connected toys while driving, cycling or operating machinery. There is no automatic pause.',
  'E-stim: never place electrodes across the chest or heart, or above the neck; follow the instructions of your device. Do not use it with a pacemaker or heart condition.',
  'Your limits (maximum intensity and duration) are applied by Lockation and in the XToys script. Choose them carefully – during a lock they can only be changed by disconnecting (which may be punished).',
  'Lockation cannot confirm that a toy reacted. XToys must be running with your toys connected. XToys is a third-party service.',
  'Only adults, only with consent. Stop immediately if anything hurts or feels wrong – your health comes before any rule.',
];
