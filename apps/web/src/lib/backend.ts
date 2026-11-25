/** Backend abstraction: real Cloudflare Worker or in-browser demo (F13). */
import type { CheckinPurpose, CheckinRecord, ConfigIssue, Fix, LockationConfig, SessionView, HuntAction, MissionAction } from '@lockation/core';

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
  config: LockationConfig;
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

export interface NotificationSetup {
  topic: string;
  /** `https://ntfy.sh/<topic>` – works in the browser and as QR code. */
  url: string;
  /** `ntfy://ntfy.sh/<topic>` – opens the ntfy app directly. */
  deepLink: string;
  view: SessionView;
}

export interface Backend {
  readonly demo: boolean;
  session(): Promise<SessionView>;
  checkin(fix: Fix, purpose: CheckinPurpose): Promise<{ record: CheckinRecord; view: SessionView }>;
  downgradePrivacy(): Promise<SessionView>;
  configGet(): Promise<ConfigLoad>;
  configSave(config: LockationConfig): Promise<void>;
  capabilities(): Promise<{ commands: CommandInfo[]; live: boolean }>;
  pairTracking(): Promise<PairingResult>;
  unpairTracking(): Promise<SessionView>;
  /** ntfy push notifications for the current role (wearer warnings / keyholder events). 503 `notifications_unavailable` without server token. */
  setupNotifications(): Promise<NotificationSetup>;
  stopNotifications(): Promise<SessionView>;
  /** Wearer: hide the "rules changed" notice. */
  ackRulesChanged(): Promise<SessionView>;
  /** Send a test message to the own notification channel. */
  testNotification(): Promise<{ ok: true }>;
  /** Scavenger hunt control (who may do what depends on the lock settings). */
  huntAction(action: HuntAction): Promise<SessionView>;
  /** Surprise missions: keyholder send / cancel, wearer decline. */
  missionAction(action: MissionAction): Promise<SessionView>;
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
      throw new ApiError(0, 'network', 'Cannot reach the Lockation server. Check your internet connection.');
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
  async configSave(config: LockationConfig) {
    await this.post('/api/config/save', { ...this.cfg(), config });
  }
  async pairTracking() {
    return this.post<PairingResult>('/api/tracking/pair', this.main());
  }
  async unpairTracking() {
    return this.post<SessionView>('/api/tracking/unpair', this.main());
  }
  async setupNotifications() {
    return this.post<NotificationSetup>('/api/notify/setup', this.main());
  }
  async stopNotifications() {
    return this.post<SessionView>('/api/notify/stop', this.main());
  }
  async ackRulesChanged() {
    return this.post<SessionView>('/api/notice/ack', this.main());
  }
  async testNotification() {
    return this.post<{ ok: true }>('/api/notify/test', this.main());
  }
  async huntAction(action: HuntAction) {
    return this.post<SessionView>('/api/hunt', { ...this.main(), action });
  }
  async missionAction(action: MissionAction) {
    return this.post<SessionView>('/api/mission', { ...this.main(), action });
  }
  async capabilities() {
    return this.post<{ commands: CommandInfo[]; live: boolean }>(
      '/api/capabilities',
      this.tokens.mainToken ? { mainToken: this.tokens.mainToken } : this.cfg(),
    );
  }
}
