/**
 * Bridge between the Web UI and the native ObjC shell.
 *
 * Native side: WKScriptMessageHandler("chat") + window.__onNative(json).
 * In a plain desktop browser (no native shell) a mock implementation keeps the
 * UI usable so the layout can be previewed and screenshotted.
 */

export type Msg = { type: string; [key: string]: any };

interface Waiter {
  type: string;
  match?: (m: Msg) => boolean;
  resolve: (m: Msg) => void;
  timer: number;
}

function nativeAvailable(): boolean {
  const w = window as any;
  return !!(w.webkit && w.webkit.messageHandlers && w.webkit.messageHandlers.chat);
}

export class Bridge {
  readonly native: boolean = nativeAvailable();
  private waiters: Waiter[] = [];
  private listeners: { [type: string]: Array<(m: Msg) => void> } = {};
  private mockTimer = 0;

  constructor() {
    (window as any).__onNative = (msg: Msg) => this.receive(msg);
    if (!this.native) {
      // desktop preview: pretend the shell is ready shortly after boot
      setTimeout(() => this.receive({ type: 'ready', build: 'mock', platform: 'desktop' }), 30);
    }
  }

  on(type: string, fn: (m: Msg) => void): void {
    (this.listeners[type] = this.listeners[type] || []).push(fn);
  }

  post(op: string, data?: { [key: string]: any }): void {
    const payload: any = { op: op };
    if (data) {
      for (const k in data) {
        if (Object.prototype.hasOwnProperty.call(data, k)) {
          payload[k] = data[k];
        }
      }
    }
    if (!this.native) {
      this.mockReply(op, payload);
      return;
    }
    (window as any).webkit.messageHandlers.chat.postMessage(payload);
  }

  request(
    op: string,
    data: { [key: string]: any } | undefined,
    expect: string,
    timeoutMs?: number,
    match?: (m: Msg) => boolean
  ): Promise<Msg> {
    const self = this;
    return new Promise<Msg>(function (resolve, reject) {
      const timer = window.setTimeout(function () {
        for (let i = self.waiters.length - 1; i >= 0; i--) {
          if (self.waiters[i].timer === timer) {
            self.waiters.splice(i, 1);
          }
        }
        reject(new Error('timeout: ' + expect));
      }, timeoutMs || 20000);
      self.waiters.push({ type: expect, match: match, resolve: resolve, timer: timer });
      self.post(op, data);
    });
  }

  private receive(msg: Msg): void {
    if (!msg || !msg.type) {
      return;
    }
    for (let i = this.waiters.length - 1; i >= 0; i--) {
      const w = this.waiters[i];
      if (w.type === msg.type && (!w.match || w.match(msg))) {
        this.waiters.splice(i, 1);
        window.clearTimeout(w.timer);
        w.resolve(msg);
        return;
      }
    }
    const fns = this.listeners[msg.type];
    if (fns) {
      for (let j = 0; j < fns.length; j++) {
        fns[j](msg);
      }
    }
  }

  /* ---------------------------------------------------------------- mock -- */

  private mockReply(op: string, payload: any): void {
    const self = this;
    if (op === 'config.get' || op === 'config.set') {
      this.receive({ type: 'config', config: payload.config || MOCK_CONFIG });
      return;
    }
    if (op === 'store.load') {
      this.receive({ type: 'store', data: { messages: [] } });
      return;
    }
    if (op === 'store.save' || op === 'store.clear') {
      this.receive({ type: 'ok', op: op });
      return;
    }
    if (op === 'models.fetch') {
      setTimeout(function () {
        self.receive({ type: 'models', models: MOCK_MODELS, raw: null });
      }, 200);
      return;
    }
    if (op === 'image.pick') {
      setTimeout(function () {
        self.receive({ type: 'cancel', requestId: payload.requestId || '' });
      }, 50);
      return;
    }
    if (op === 'chat.stop') {
      if (this.mockTimer) {
        window.clearInterval(this.mockTimer);
        this.mockTimer = 0;
      }
      this.receive({ type: 'aborted', requestId: payload.requestId });
      return;
    }
    if (op === 'chat.start') {
      const rid = payload.requestId;
      const text = MOCK_REPLY;
      let i = 0;
      if (this.mockTimer) {
        window.clearInterval(this.mockTimer);
      }
      this.mockTimer = window.setInterval(function () {
        const next = Math.min(text.length, i + 3);
        const chunk = text.slice(i, next);
        i = next;
        if (chunk) {
          self.receive({ type: 'delta', requestId: rid, text: chunk });
        }
        if (i >= text.length) {
          window.clearInterval(self.mockTimer);
          self.mockTimer = 0;
          self.receive({ type: 'done', requestId: rid, usage: null });
        }
      }, 40);
      return;
    }
    if (op === 'log.write') {
      return;
    }
  }
}

export const MOCK_CONFIG: any = {
  provider: 'DeepSeek',
  baseUrl: 'https://api.deepseek.com/v1',
  port: 443,
  apiKey: '',
  model: 'deepseek-chat',
  models: ['deepseek-chat', 'deepseek-reasoner', 'gpt-4o-mini'],
  thinking: { enabled: false, level: 0, param: 'reasoning_effort', onValue: 'high', offValue: '' },
  fontSize: 16
};

const MOCK_MODELS = ['deepseek-chat', 'deepseek-reasoner', 'gpt-4o-mini', 'qwen-max'];

const MOCK_REPLY =
  '好的，先给你一个最小可行方案：\n\n' +
  '- 界面只保留一个输入入口和一处设置\n' +
  '- 网络层只做一个转发接口，不做账号体系\n' +
  '- 配置全部存在本机，换模型时不改动界面\n\n' +
  '需要我把它拆成可执行的任务清单吗？';