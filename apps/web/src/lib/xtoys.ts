/** F27 – sending commands to the wearer's XToys webhook straight from the browser (toy page and demo). */
import { xtoysWebhookUrl, type ToyWebhookBody } from '@lockation/core';

/**
 * Send one command. GET with query parameters is a "simple" request (no CORS preflight); if the browser still blocks
 * reading the answer, the request is repeated without reading it (`no-cors`) – it reaches XToys, but unconfirmed.
 */
export async function sendToXToys(webhookId: string, body: ToyWebhookBody, fetchImpl: typeof fetch = fetch): Promise<'ok' | 'unconfirmed'> {
  const r = await sendRaw(webhookId, body, 'GET', fetchImpl);
  if (r.outcome === 'error') throw new Error(r.detail);
  return r.outcome;
}

export interface SendResult {
  outcome: 'ok' | 'unconfirmed' | 'error';
  /** What was sent (URL, and the JSON body for POST). */
  request: string;
  /** HTTP status and XToys' answer, or why it could not be read. */
  detail: string;
}

/** Send any webhook message (debugging): GET with query parameters or POST with a JSON body. */
export async function sendRaw(webhookId: string, params: Record<string, string>, method: 'GET' | 'POST', fetchImpl: typeof fetch = fetch): Promise<SendResult> {
  const base = xtoysWebhookUrl(webhookId);
  const url = method === 'GET' ? `${base}?${new URLSearchParams(params).toString()}` : base;
  const init: RequestInit = method === 'GET' ? { method } : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params) };
  const request = method === 'GET' ? `GET ${url}` : `POST ${url}\n${JSON.stringify(params)}`;
  try {
    const res = await fetchImpl(url, { ...init, mode: 'cors' });
    const text = await res.text().catch(() => '');
    const detail = `HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ''}`;
    if (!res.ok) return { outcome: 'error', request, detail: `${detail}${res.status === 404 ? ' – check the Webhook ID' : ''}` };
    return { outcome: 'ok', request, detail };
  } catch (e) {
    if (!(e instanceof TypeError)) return { outcome: 'error', request, detail: e instanceof Error ? e.message : String(e) };
    // CORS: the browser hides the answer. Send again without reading it – it still reaches XToys.
    try {
      await fetchImpl(url, { ...init, mode: 'no-cors', ...(method === 'POST' ? { headers: { 'Content-Type': 'text/plain' } } : {}) });
      return { outcome: 'unconfirmed', request, detail: 'sent, but the browser may not read XToys’ answer (CORS)' };
    } catch (e2) {
      return { outcome: 'error', request, detail: `network error: ${e2 instanceof Error ? e2.message : String(e2)}` };
    }
  }
}
