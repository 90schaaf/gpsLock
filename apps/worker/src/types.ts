/** Minimal Cloudflare runtime types (kept local to avoid a hard dependency on workers-types). */
export interface KVLike {
  get(key: string, type: 'json'): Promise<unknown>;
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface Env {
  KV: KVLike;
  CHASTER_TOKEN: string;
  CHASTER_API_BASE?: string;
  ALLOWED_ORIGINS?: string;
  EXTENSION_SLUG?: string;
  WEBHOOK_USERNAME?: string;
  WEBHOOK_PASSWORD?: string;
  /** Public URL of this worker (optional; defaults to the request origin). */
  PUBLIC_URL?: string;
}

export interface ExecutionContextLike {
  waitUntil(p: Promise<unknown>): void;
}

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}
