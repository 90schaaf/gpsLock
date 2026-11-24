/** Minimal Cloudflare runtime types (kept local to avoid a hard dependency on workers-types). */
/** Subset of the Cloudflare D1 binding we use. */
export interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  run(): Promise<unknown>;
  all<T = unknown>(): Promise<{ results: T[] }>;
  first<T = unknown>(): Promise<T | null>;
}
export interface D1Like {
  prepare(sql: string): D1Statement;
}

export interface Env {
  DB: D1Like;
  CHASTER_TOKEN: string;
  CHASTER_API_BASE?: string;
  ALLOWED_ORIGINS?: string;
  EXTENSION_SLUG?: string;
  WEBHOOK_USERNAME?: string;
  WEBHOOK_PASSWORD?: string;
  /** Public URL of this worker (optional; defaults to the request origin). */
  PUBLIC_URL?: string;
  /** ntfy server (default https://ntfy.sh) and access token; without a token notifications are disabled. */
  NTFY_BASE?: string;
  NTFY_TOKEN?: string;
  /** URL of the check-in page, used as click target in notifications. */
  APP_URL?: string;
  /** Set at deploy time (CI: full commit SHA, local: short SHA) – shown by /health. */
  GIT_SHA?: string;
  DEPLOYED_AT?: string;
}

export interface ExecutionContextLike {
  waitUntil(p: Promise<unknown>): void;
}

/** HTTP errors are the shared application errors (status, code, message, details). */
export { AppError as HttpError } from '@lockation/core';
