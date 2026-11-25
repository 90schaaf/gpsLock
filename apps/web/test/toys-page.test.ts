// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { h, render } from 'preact';
import { defaultToy, ToySetupSchema } from '@lockation/core';
import { formatConnected, sendToXToys, ToysApp } from '../src/toys/ToysApp.js';

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('toy test page', () => {
  it('sends a GET with the command to the wearer’s webhook; falls back to no-cors', async () => {
    const calls: { url: string; mode?: string }[] = [];
    const ok = (async (url: string, init?: RequestInit) => {
      calls.push({ url, mode: init?.mode });
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    expect(await sendToXToys(' ABC123 ', { action: 'lockation', cmd: 'stopAll' }, ok)).toBe('ok');
    expect(calls[0]!.url).toBe('https://webhook.xtoys.app/ABC123?action=lockation&cmd=stopAll');
    let n = 0;
    const blocked = (async (_url: string, init?: RequestInit) => {
      n++;
      if (init?.mode === 'cors') throw new TypeError('Failed to fetch');
      return { ok: false, status: 0 } as Response; // opaque no-cors response
    }) as unknown as typeof fetch;
    expect(await sendToXToys('ABC', { action: 'lockation', cmd: 'stopAll' }, blocked)).toBe('unconfirmed');
    expect(n).toBe(2);
  });

  it('needs the disclaimer before testing; stop all always works; adds toys and offers the script', async () => {
    localStorage.clear();
    const sent: string[] = [];
    const f = (async (url: string) => {
      sent.push(url);
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    const el = document.createElement('div');
    document.body.appendChild(el);
    render(h(ToysApp, { fetchImpl: f }), el);
    await tick();
    (el.querySelector('[data-testid="toy-add"] button') as HTMLButtonElement).click(); // + Vibrator
    await tick();
    expect(el.querySelectorAll('[data-testid="toy-item"]')).toHaveLength(1);
    const input = el.querySelector('[data-testid="toy-webhook"]') as HTMLInputElement;
    input.value = 'WH1';
    input.dispatchEvent(new Event('input'));
    await tick();
    const testAll = el.querySelector('[data-testid="toy-test-all"]') as HTMLButtonElement;
    expect(testAll.disabled).toBe(true); // disclaimer not accepted
    (el.querySelector('[data-testid="toy-stop-all"]') as HTMLButtonElement).click();
    await tick();
    expect(sent[0]).toContain('cmd=stopAll');
    (el.querySelector('[data-testid="toy-disclaimer"] input') as HTMLInputElement).click();
    await tick();
    expect((el.querySelector('[data-testid="toy-test-all"]') as HTMLButtonElement).disabled).toBe(false);
    expect((el.querySelector('[data-testid="toy-script"]') as HTMLButtonElement).disabled).toBe(false);
    expect(localStorage.getItem('lockation-toys-webhook')).toBeNull(); // not remembered unless asked
  });

  it('explains the getToys answer per toy', () => {
    const setup = ToySetupSchema.parse({ toys: [defaultToy('vibrator', 'a', 'Bullet'), defaultToy('estim', 'b', 'Box')] });
    const text = formatConnected(setup, JSON.stringify({ 'part-vibrator-a': [{ name: 'Lush' }], 'part-estim|part-estim-a': [] }));
    expect(text).toBe('✅ Bullet: Lush\n⚠ Box: no toy connected to this slot');
  });
});
