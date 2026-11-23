import type { Backend } from './backend.js';
import { HttpBackend } from './backend.js';
import { getStringParam, isDemo, parseHashParams } from './hash.js';
import { MockBackend } from './mock-backend.js';

export const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') ?? '';
export const CHASTER_ORIGINS = ((import.meta.env.VITE_CHASTER_ORIGINS as string | undefined) ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
export const DOCS_URL = '../';

export function createBackend(): { backend: Backend; mock?: MockBackend; params: Record<string, unknown> } {
  const params = parseHashParams(window.location.hash);
  if (isDemo(window.location.search)) {
    const mock = new MockBackend();
    return { backend: mock, mock, params };
  }
  return {
    backend: new HttpBackend(API_BASE, {
      mainToken: getStringParam(params, 'mainToken'),
      configToken: getStringParam(params, 'partnerConfigurationToken'),
    }),
    params,
  };
}
