/** Backend abstraction: real Cloudflare Worker or in-browser demo (F13). */
import type { CheckinPurpose, CheckinRecord, ConfigIssue, Fix, GpsLockConfig, SessionView } from '@gps-lock/core';

export interface CommandInfo {
  id: string;
  extension: string;
  title: string;
  description: string;
  available: boolean;
  reason?: string | null;
  exampleInput?: Record<string, unknown>;
  inputSchema?: unknown;
}

export interface ConfigLoad {
  config: GpsLockConfig;
  role: 'wearer' | 'keyholder';
  sessionId: string | null;
  invalidStoredConfig?: ConfigIssue[];
}

export interface PairingResult {
  link: string;
  url: string;
  username: string;
  password: string;
  view: SessionView;
}

export interface Backend {
  readonly demo: boolean;
  session(): Promise<SessionView>;
  checkin(fix: Fix, purpose: CheckinPurpose): Promise<{ record: CheckinRecord; view: SessionView }>;
  downgradePrivacy(): Promise<SessionView>;
  configGet(): Promise<ConfigLoad>;
  configSave(config: GpsLockConfig): Promise<void>;
  capabilities(): Promise<{ commands: CommandInfo[]; live: boolean }>;
  pairTracking(): Promise<PairingResult>;
  unpairTracking(): Promise<SessionView>;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export class HttpBackend implements Backend {
  readonly demo = false;
  constructor(
    private base: string,
    private tokens: { mainToken?: string; configToken?: string },
    private fetchImpl: typeof fetch = (...a) => fetch(...a),
  ) {}

  private async post<T>(path: string, body: Record<string, unknown>): Promise<T> {
    if (!this.base) throw new ApiError(0, 'not_configured', 'The backend URL is not configured (VITE_API_BASE).');
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    } catch {
      throw new ApiError(0, 'network', 'Cannot reach the GPS Lock server. Check your internet connection.');
    }
    const json = (await res.json().catch(() => ({}))) as { error?: { code: string; message: string; details?: unknown } };
    if (!res.ok) throw new ApiError(res.status, json.error?.code ?? 'error', json.error?.message ?? `Request failed (${res.status})`, json.error?.details);
    return json as T;
  }

  private main() {
    if (!this.tokens.mainToken) throw new ApiError(401, 'missing_token', 'No session token – open this page from your lock in Chaster.');
    return { mainToken: this.tokens.mainToken };
  }

  private cfg() {
    if (!this.tokens.configToken) throw new ApiError(401, 'missing_token', 'No configuration token – open this page from Chaster.');
    return { configToken: this.tokens.configToken };
  }

  async session() {
    return this.post<SessionView>('/api/session', this.main());
  }
  async checkin(fix: Fix, purpose: CheckinPurpose) {
    return this.post<{ record: CheckinRecord; view: SessionView }>('/api/checkin', { ...this.main(), fix, purpose });
  }
  async downgradePrivacy() {
    return this.post<SessionView>('/api/privacy', { ...this.main(), coordinates: 'zone_only' });
  }
  async configGet() {
    return this.post<ConfigLoad>('/api/config/get', this.cfg());
  }
  async configSave(config: GpsLockConfig) {
    await this.post('/api/config/save', { ...this.cfg(), config });
  }
  async pairTracking() {
    return this.post<PairingResult>('/api/tracking/pair', this.main());
  }
  async unpairTracking() {
    return this.post<SessionView>('/api/tracking/unpair', this.main());
  }
  async capabilities() {
    return this.post<{ commands: CommandInfo[]; live: boolean }>(
      '/api/capabilities',
      this.tokens.mainToken ? { mainToken: this.tokens.mainToken } : this.cfg(),
    );
  }
}
