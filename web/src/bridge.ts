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
      const searching = DEMO_MODE === 'search';
      const text =
        DEMO_MODE === 'table' ? MOCK_TABLE_REPLY : searching ? MOCK_SEARCH_REPLY : MOCK_REPLY;
      const reasoning = DEMO_MODE === 'table' || searching ? '' : MOCK_REASONING;
      let ri = 0;
      let i = 0;
      if (this.mockTimer) {
        window.clearInterval(this.mockTimer);
      }
      if (searching) {
        window.setTimeout(function () {
          self.receive({ type: 'searching', requestId: rid });
        }, 150);
        window.setTimeout(function () {
          self.receive({ type: 'sources', requestId: rid, items: MOCK_SOURCES });
        }, 500);
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
    if (op === 'image.pick') {
      // desktop preview: generate a small sample picture instead of a picker
      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 400;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#f6f6f2';
        ctx.fillRect(0, 0, 640, 400);
        ctx.strokeStyle = '#3a2a1a';
        ctx.lineWidth = 16;
        ctx.beginPath();
        ctx.ellipse(320, 200, 150, 100, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = '#3a2a1a';
        ctx.beginPath();
        ctx.ellipse(320, 200, 22, 70, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      const url = canvas.toDataURL('image/jpeg', 0.8);
      self.receive({
        type: 'image',
        requestId: payload.requestId || '',
        image: {
          mime: 'image/jpeg',
          dataBase64: url.split(',')[1] || '',
          width: 640,
          height: 400
        }
      });
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
  search: {
    mode: 'auto',
    url: 'https://api.exa.ai/search',
    key: '',
    header: 'x-api-key',
    prefix: '',
    body: '{"query":"{{query}}","numResults":{{num}},"contents":{"text":{"maxCharacters":800}}}',
    num: 5
  },
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

/* Preview fixtures for web/_preview: ?demo=search and ?demo=table. */
const DEMO_MODE = (function () {
  const m = typeof location !== 'undefined' ? /[?&]demo=([a-z]+)/.exec(location.search) : null;
  return m ? m[1] : '';
}());

const MOCK_SOURCES = [
  {
    index: 1,
    title: '端侧推理芯片发布：能效比提升 3 倍',
    url: 'https://example.com/news/chip',
    snippet: '新芯片主打低功耗推理，官方给出的数据是同等功耗下吞吐提升三倍。'
  },
  {
    index: 2,
    title: '兼容 32 位 ARM 的开源推理运行时',
    url: 'https://example.com/blog/arm32-runtime',
    snippet: '项目 README 说明它支持 armv7 与 arm64，并给出了老设备上的基准数据。'
  },
  {
    index: 3,
    title: '在老 iPad 上跑大模型是什么体验',
    url: 'https://example.com/post/ipad-llm',
    snippet: '作者用一台 iPad 4 做了两周实测，记录了发热、耗电与响应速度。'
  }
];

const MOCK_SEARCH_REPLY =
  '根据刚才检索到的三条资料，今天值得关注的科技新闻是：\n\n' +
  '1. 有厂商发布了新一代**端侧推理芯片**，主打同等功耗下更高的吞吐[1]；\n' +
  '2. 开源社区放出了兼容 **32 位 ARM** 的推理运行时，附带了老设备基准[2]；\n' +
  '3. 一篇复盘文章记录了在 iPad 4 上跑大模型两周的真实体验[3]。\n\n' +
  '你更关心哪一条？我可以把细节展开，或者继续检索它的后续报道。';

const MOCK_TABLE_REPLY =
  '三档方案对比如下：\n\n' +
  '| 方案 | 成本 | 适合场景 |\n' +
  '|:---|:---:|---:|\n' +
  '| 只改交互 | 低 | 现有体验微调 |\n' +
  '| 重做首页 | 中 | 信息架构混乱 |\n' +
  '| 换技术栈 | 高 | 长期维护 |\n\n' +
  '执行顺序：\n\n' +
  '- [x] 梳理现有交互\n' +
  '- [ ] 统一设置入口\n' +
  '- [ ] 补上来源列表\n\n' +
  '需要我把第二档拆成具体任务吗？';