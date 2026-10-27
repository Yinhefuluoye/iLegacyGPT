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
      this.receive({ type: 'store', data: MOCK_STORE });
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
      const reasoning = MOCK_REASONING;
      let ri = 0;
      let i = 0;
      if (this.mockTimer) {
        window.clearInterval(this.mockTimer);
      }
      this.mockTimer = window.setInterval(function () {
        if (ri < reasoning.length) {
          const rn = Math.min(reasoning.length, ri + 5);
          self.receive({ type: 'reasoning', requestId: rid, text: reasoning.slice(ri, rn) });
          ri = rn;
          return;
        }
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

/* Desktop preview only: pretend there is already a little archive on disk. */
const NOW = Date.now();
const DAY = 86400000;
const MOCK_STORE: any = {
  v: 2,
  currentId: 's-demo-1',
  sessions: [
    {
      id: 's-demo-1',
      title: '帮我简化 iPad 客户端交互',
      createdAt: NOW - 2 * DAY,
      updatedAt: NOW - 3 * 60000,
      messages: [
        { id: 'm1', role: 'user', content: '帮我简化 iPad 客户端的交互', ts: NOW - 3 * 60000 },
        {
          id: 'm2',
          role: 'assistant',
          content:
            '好的，先给你一个最小可行方案：\n\n' +
            '- 界面只保留一个输入入口和一处设置\n' +
            '- 网络层只做一个转发接口，不做账号体系\n' +
            '- 配置全部存在本机，换模型时不改动界面',
          ts: NOW - 3 * 60000 + 1200
        }
      ]
    },
    {
      id: 's-demo-2',
      title: '把思考档位加到输入框',
      createdAt: NOW - DAY,
      updatedAt: NOW - DAY,
      messages: [
        { id: 'm3', role: 'user', content: '把思考档位加到输入框', ts: NOW - DAY },
        {
          id: 'm4',
          role: 'assistant',
          content: '可以做成一枚 chip：关闭 / 低 / 中 / 高，换算成 reasoning_effort 的 low、medium、high。',
          ts: NOW - DAY + 2000
        }
      ]
    },
    {
      id: 's-demo-3',
      title: 'OpenAI 兼容接口的流式解析',
      createdAt: NOW - 4 * DAY,
      updatedAt: NOW - 3 * DAY,
      messages: [{ id: 'm5', role: 'user', content: 'OpenAI 兼容接口的流式解析', ts: NOW - 3 * DAY }]
    },
    {
      id: 's-demo-4',
      title: '确认浅色主题的配色',
      createdAt: NOW - 6 * DAY,
      updatedAt: NOW - 5 * DAY,
      messages: [{ id: 'm6', role: 'user', content: '确认浅色主题的配色', ts: NOW - 5 * DAY }]
    }
  ]
};

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

const MOCK_REASONING =
  '先看约束：32 位设备、iOS 10、WKWebView 只负责渲染。' +
  '界面越少越好，所以核心是输入框 + 一处设置。' +
  '网络层只做转发，不引入账号体系，配置留在本机即可。';