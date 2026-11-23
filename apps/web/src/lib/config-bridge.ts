/**
 * postMessage protocol between the configuration iframe and Chaster (F11).
 * page → Chaster: {type:"partner_configuration", event:"capabilities"|"save_loading"|"save_success"|"save_failed", payload}
 * Chaster → page: {type:"chaster", event:"partner_configuration_save"}
 */
export type OutgoingEvent = 'capabilities' | 'save_loading' | 'save_success' | 'save_failed';

export interface BridgeWindow {
  parent: { postMessage(message: string, targetOrigin: string): void } | null;
  addEventListener(type: 'message', cb: (e: MessageEvent) => void): void;
  removeEventListener(type: 'message', cb: (e: MessageEvent) => void): void;
}

export class ConfigBridge {
  private listener?: (e: MessageEvent) => void;

  constructor(
    private win: BridgeWindow,
    private allowedOrigins: string[] = [],
  ) {}

  send(event: OutgoingEvent, payload: unknown = {}) {
    this.win.parent?.postMessage(JSON.stringify({ type: 'partner_configuration', event, payload }), '*');
  }

  announce() {
    this.send('capabilities', { features: { save: true } });
  }

  /** Accepts only messages coming from the parent frame (and from allowed origins, if configured). */
  onSaveRequested(cb: () => void) {
    this.listener = (e: MessageEvent) => {
      if (this.win.parent && e.source !== null && e.source !== (this.win.parent as unknown)) return;
      if (this.allowedOrigins.length && !this.allowedOrigins.includes(e.origin)) return;
      let data: unknown = e.data;
      if (typeof data === 'string') {
        try {
          data = JSON.parse(data);
        } catch {
          return;
        }
      }
      if (data && typeof data === 'object' && (data as { type?: string }).type === 'chaster' && (data as { event?: string }).event === 'partner_configuration_save') {
        cb();
      }
    };
    this.win.addEventListener('message', this.listener);
    return () => this.listener && this.win.removeEventListener('message', this.listener);
  }

  /** Runs the save flow: loading → success | failed. */
  async runSave(save: () => Promise<void>): Promise<boolean> {
    this.send('save_loading');
    try {
      await save();
      this.send('save_success');
      return true;
    } catch {
      this.send('save_failed');
      return false;
    }
  }
}
