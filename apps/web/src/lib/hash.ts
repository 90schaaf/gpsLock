/** Chaster passes parameters as a URI-encoded JSON object in the URL hash. (F10 AC1) */
export function parseHashParams(hash: string): Record<string, unknown> {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!raw) return {};
  try {
    const parsed = JSON.parse(decodeURIComponent(raw));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function getStringParam(params: Record<string, unknown>, key: string): string | undefined {
  const v = params[key];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

export function isDemo(search: string): boolean {
  return new URLSearchParams(search).has('demo');
}

export function isEmbedded(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}
