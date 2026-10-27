import { Bridge } from './bridge';
import type { Msg } from './bridge';
import { renderMarkdown } from './markdown';

const LEVELS = [
  { level: 0, name: '关闭', desc: '不启用思考，响应最快' },
  { level: 1, name: '低', desc: '简短思考，适合日常问答' },
  { level: 2, name: '中', desc: '深度与速度平衡' },
  { level: 3, name: '高', desc: '充分推理，复杂任务' }
];
const LEVEL_API = ['', 'low', 'medium', 'high'];
const THINK_BUDGET = [1024, 4096, 16384];

const PROVIDERS: { [key: string]: { label: string; base: string } } = {
  openai: { label: 'OpenAI', base: 'https://api.openai.com/v1' },
  deepseek: { label: 'DeepSeek', base: 'https://api.deepseek.com/v1' },
  bailian: { label: '阿里云百炼', base: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
  custom: { label: '自定义', base: '' }
};

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  reasoning?: string;
  image?: { dataBase64?: string; mime: string; thumb?: string } | null;
  error?: boolean;
  ts?: number;
}

function $(id: string): any {
  return document.getElementById(id);
}

function el(tag: string, cls?: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (cls) {
    node.className = cls;
  }
  if (text != null) {
    node.textContent = text;
  }
  return node;
}

function uid(): string {
  return 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function formatBytes(bytes: number): string {
  if (!bytes) {
    return '图片';
  }
  if (bytes < 1024 * 1024) {
    return Math.max(1, Math.round(bytes / 1024)) + ' KB';
  }
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

function pad2(n: number): string {
  return (n < 10 ? '0' : '') + n;
}

interface Session {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: Message[];
}

export class App {
  private bridge: Bridge;
  private config: any = {};
  private messages: Message[] = [];
  private sessions: Session[] = [];
  private currentId = '';
  private openRowId = '';
  private buildInfo = '';
  private requestId = '';
  private streaming = false;
  private attach: { dataBase64: string; mime: string; bytes?: number; thumb?: string } | null = null;
  private modelsOpenAfter = false;
  private saveTimer = 0;
  private renderTimer = 0;
  private cleanups: Array<() => void> = [];

  // cached nodes
  private app!: HTMLElement;
  private heroComposer!: HTMLElement;
  private composer!: HTMLElement;
  private dock!: HTMLElement;
  private dockHost!: HTMLElement;
  private thread!: HTMLElement;
  private threadInner!: HTMLElement;
  private input!: HTMLTextAreaElement;
  private sendBtn!: HTMLElement;
  private attachRow!: HTMLElement;
  private attachThumb!: HTMLImageElement;
  private attachName!: HTMLElement;
  private modelChipName!: HTMLElement;
  private thinkChip!: HTMLElement;
  private thinkLabel!: HTMLElement;
  private modelList!: HTMLElement;
  private modelCount!: HTMLElement;
  private thinkList!: HTMLElement;
  private toastEl!: HTMLElement;
  private toastTimer = 0;
  private drawerLayer!: HTMLElement;
  private drawerScrim!: HTMLElement;
  private sessionList!: HTMLElement;

  constructor(bridge: Bridge) {
    this.bridge = bridge;
  }

  async init(): Promise<void> {
    this.cacheNodes();
    this.bindEvents();
    this.bindBridge();

    const ready = await new Promise<Msg | null>((resolve) => {
      const timer = window.setTimeout(() => resolve(null), 6000);
      this.bridge.on('ready', (m) => {
        window.clearTimeout(timer);
        resolve(m);
      });
    });
    const build = ready && ready.build ? String(ready.build) : 'unknown';
    this.setBuildInfo(build);

    try {
      const cfg = await this.bridge.request('config.get', undefined, 'config', 8000);
      this.config = this.normalizeConfig(cfg.config || {});
    } catch (e) {
      this.config = this.normalizeConfig({});
    }
    this.applyConfig();

    try {
      const store = await this.bridge.request('store.load', undefined, 'store', 8000);
      this.loadSessions((store.data || {}) as any);
    } catch (e) {
      this.loadSessions({});
    }
    this.renderAll();
  }

  /* ------------------------------------------------------------- setup -- */

  private cacheNodes(): void {
    this.app = $('app');
    this.heroComposer = $('heroComposer');
    this.composer = $('composer');
    this.dock = $('dock');
    this.dockHost = $('dockHost');
    this.thread = $('thread');
    this.threadInner = $('threadInner');
    this.input = $('chatInput');
    this.sendBtn = $('sendBtn');
    this.attachRow = $('attachRow');
    this.attachThumb = $('attachThumb');
    this.attachName = $('attachName');
    this.modelChipName = $('modelChipName');
    this.thinkChip = $('thinkChip');
    this.thinkLabel = $('thinkLabel');
    this.modelList = $('modelList');
    this.modelCount = $('modelCount');
    this.thinkList = $('thinkList');
    this.toastEl = $('toast');
    this.drawerLayer = $('drawerLayer');
    this.drawerScrim = $('drawerScrim');
    this.sessionList = $('sessionList');
  }

  private on(node: any, ev: string, fn: (e: any) => void): void {
    if (!node) {
      return;
    }
    node.addEventListener(ev, fn, false);
    this.cleanups.push(() => node.removeEventListener(ev, fn, false));
  }

  private bindEvents(): void {
    this.on($('settingsBtn'), 'click', () => this.openSettings());
    this.on($('searchChip'), 'click', () => this.toggleSearch());
    this.bindSearchFields();
    this.on($('settingsClose'), 'click', () => this.closeOverlay($('settingsOverlay')));
    this.on($('newChatBtn'), 'click', () => this.newChat());
    this.on($('plusBtn'), 'click', () => this.pickImage());
    this.on($('attachRemove'), 'click', () => this.clearAttach());
    this.on($('modelChip'), 'click', () => this.openModels());
    this.on($('modelClose'), 'click', () => this.closeOverlay($('modelOverlay')));
    this.on($('thinkChip'), 'click', () => this.openThink());
    this.on($('thinkClose'), 'click', () => this.closeOverlay($('thinkOverlay')));
    this.on($('sendBtn'), 'click', () => (this.streaming ? this.stop() : this.send()));

    this.on(this.input, 'input', () => {
      this.autogrow();
      this.refreshSendState();
    });
    this.on(this.input, 'keydown', (e: any) => {
      // Enter inserts a newline (the iOS "换行" key must not send);
      // Cmd/Ctrl+Enter sends, for hardware keyboards.
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.isComposing) {
        e.preventDefault();
        if (!this.streaming) {
          this.send();
        }
      }
    });
    this.on(this.input, 'focus', () => this.composer.classList.add('is-focused'));
    this.on(this.input, 'blur', () => this.composer.classList.remove('is-focused'));

    // overlays: click on the dimmed background closes
    ['settingsOverlay', 'modelOverlay', 'thinkOverlay'].forEach((id) => {
      const ov = $(id);
      this.on(ov, 'click', (e: any) => {
        if (e.target === ov) {
          this.closeOverlay(ov);
        }
      });
    });

    // settings controls
    this.on($('fontDec'), 'click', () => this.changeFont(-1));
    this.on($('fontInc'), 'click', () => this.changeFont(1));
    this.on($('providerSelect'), 'change', () => {
      const key = $('providerSelect').value;
      const preset = PROVIDERS[key];
      if (preset && preset.base) {
        $('apiUrl').value = preset.base;
      }
      this.saveSettings();
    });
    this.on($('apiUrl'), 'change', () => this.saveSettings());
    this.on($('apiPort'), 'change', () => this.saveSettings());
    this.on($('apiKey'), 'change', () => this.saveSettings());
    this.on($('refreshModelsBtn'), 'click', () => this.fetchModels());
    this.on($('thinkParamSelect'), 'change', () => {
      this.config.thinking.mode = $('thinkParamSelect').value;
      this.updateThinkParamNote();
      this.saveConfig();
    });
    this.on($('clearChatBtn'), 'click', () => this.clearAll());

    // session drawer
    this.on($('menuBtn'), 'click', () => this.openDrawer());
    this.on($('drawerClose'), 'click', () => this.closeDrawer());
    this.on(this.drawerScrim, 'click', () => this.closeDrawer());
    this.on($('drawerNew'), 'click', () => this.newChat());
    this.on(this.sessionList, 'click', (e: any) => {
      const target = e.target as HTMLElement;
      const row = target.closest ? (target.closest('.session-row') as HTMLElement | null) : null;
      if (!row) {
        this.setOpenRow('');
        return;
      }
      const id = row.getAttribute('data-id') || '';
      if (!id) {
        return;
      }
      if (target.closest && target.closest('.session-act')) {
        if (target.closest('.is-danger')) {
          this.deleteSession(id);
        } else {
          this.startRename(row, id);
        }
        return;
      }
      if (target.closest && target.closest('.session-content')) {
        if (this.openRowId === id) {
          this.setOpenRow('');
          return;
        }
        this.switchSession(id);
      }
    });
    this.on(window, 'keydown', (e: any) => {
      if (e.key === 'Escape' && this.drawerLayer.classList.contains('is-open')) {
        this.closeDrawer();
      }
    });

    this.on(window, 'resize', () => this.scrollToBottom(true));
  }

  private bindBridge(): void {
    this.bridge.on('delta', (m: Msg) => {
      if (m.requestId === this.requestId) {
        this.appendDelta(String(m.text || ''));
      }
    });
    this.bridge.on('reasoning', (m: Msg) => {
      if (m.requestId === this.requestId) {
        this.appendReasoning(String(m.text || ''));
      }
    });
    this.bridge.on('done', (m: Msg) => {
      if (m.requestId === this.requestId) {
        this.finish(true);
      }
    });
    this.bridge.on('error', (m: Msg) => {
      const ctx = String(m.context || '');
      if (ctx === 'models') {
        this.resetModelsBtn();
        this.toast(String(m.message || '刷新模型失败'));
        return;
      }
      if (ctx === 'image') {
        this.toast(String(m.message || '图片处理失败'));
        return;
      }
      if (!m.requestId || m.requestId === this.requestId) {
        this.fail(String(m.message || '请求失败'));
      }
    });
    this.bridge.on('aborted', (m: Msg) => {
      if (m.requestId === this.requestId) {
        this.finish(false);
      }
    });
    this.bridge.on('keyboard', (m: Msg) => {
      // Native already shrinks the web view to sit above the keyboard.
      document.documentElement.style.setProperty('--kb', '0px');
      this.scrollToBottom(true);
    });
    this.bridge.on('sources', (m: Msg) => this.renderSources(m.items));
    this.bridge.on('image', (m: Msg) => this.receiveImage(m));
    this.bridge.on('models', (m: Msg) => this.receiveModels(m));
    this.bridge.on('config', (m: Msg) => {
      this.config = this.normalizeConfig(m.config || this.config);
      this.applyConfig();
    });
    this.bridge.on('ok', (m: Msg) => {
      if (m.op === 'store.clear') {
        this.toast('已清空');
      }
    });
  }

  /* ------------------------------------------------------------- config -- */

  private normalizeConfig(cfg: any): any {
    const out = {
      provider: cfg.provider || 'DeepSeek',
      baseUrl: cfg.baseUrl || 'https://api.deepseek.com/v1',
      port: Number(cfg.port) || 443,
      apiKey: cfg.apiKey || '',
      model: cfg.model || 'deepseek-chat',
      models: Array.isArray(cfg.models) ? cfg.models.slice() : [],
      fontSize: Number(cfg.fontSize) || 16,
      search: {
        enabled: !!(cfg.search && cfg.search.enabled),
        url: (cfg.search && cfg.search.url) || '',
        key: (cfg.search && cfg.search.key) || '',
        header: (cfg.search && cfg.search.header) || 'Authorization',
        prefix: (cfg.search && cfg.search.prefix) || 'Bearer ',
        body: (cfg.search && cfg.search.body) || '{"query":"{{query}}","num_results":{{num}}}',
        num: Number((cfg.search && cfg.search.num) || 5)
      },
      thinking: {
        level: Number((cfg.thinking && cfg.thinking.level) || 0),
        mode: (cfg.thinking && cfg.thinking.mode) || 'auto',
        param: (cfg.thinking && cfg.thinking.param) || 'reasoning_effort',
        enabled: !!(cfg.thinking && cfg.thinking.enabled)
      }
    };
    return out;
  }

  private applyConfig(): void {
    document.documentElement.style.setProperty('--msg-size', this.config.fontSize + 'px');
    this.modelChipName.textContent = this.config.model || '模型';
    this.updateThinkChip();
    $('fontSizeValue').textContent = String(this.config.fontSize);
    const providerKey = this.providerKey(this.config.baseUrl);
    $('providerSelect').value = providerKey;
    $('apiUrl').value = this.config.baseUrl || '';
    $('apiPort').value = String(this.config.port || 443);
    $('apiKey').value = this.config.apiKey || '';
    const mode = (this.config.thinking && this.config.thinking.mode) || 'auto';
    $('thinkParamSelect').value = mode;
    this.updateThinkParamNote();
    const search = this.config.search || {};
    ($('searchUrl') as HTMLInputElement).value = search.url || '';
    ($('searchKey') as HTMLInputElement).value = search.key || '';
    ($('searchHeader') as HTMLInputElement).value = search.header || 'Authorization';
    ($('searchPrefix') as HTMLInputElement).value = search.prefix || 'Bearer ';
    ($('searchBody') as HTMLInputElement).value = search.body || '{"query":"{{query}}","num_results":{{num}}}';
    ($('searchNum') as HTMLSelectElement).value = String(search.num || 5);
    this.updateSearchChip();
  }

  private updateSearchChip(): void {
    const chip = $('searchChip');
    const label = $('searchLabel');
    const on = !!(this.config.search && this.config.search.enabled);
    chip.setAttribute('aria-pressed', on ? 'true' : 'false');
    if (on) {
      chip.classList.add('is-on');
      label.textContent = '联网 · 开';
    } else {
      chip.classList.remove('is-on');
      label.textContent = '联网';
    }
  }

  private toggleSearch(): void {
    if (!this.config.search) {
      return;
    }
    this.config.search.enabled = !this.config.search.enabled;
    if (this.config.search.enabled && !this.config.search.url) {
      this.toast('先在设置里填联网搜索 API 地址');
    }
    this.updateSearchChip();
    this.saveConfig();
  }

  private bindSearchFields(): void {
    const map = [
      ['searchUrl', 'url'],
      ['searchKey', 'key'],
      ['searchHeader', 'header'],
      ['searchPrefix', 'prefix'],
      ['searchBody', 'body']
    ];
    map.forEach((pair) => {
      const node = $(pair[0]) as HTMLInputElement | null;
      if (!node) {
        return;
      }
      this.on(node, 'change', () => {
        if (!this.config.search) {
          this.config.search = { enabled: false };
        }
        this.config.search[pair[1]] = node.value;
        this.saveConfig();
      });
    });
    this.on($('searchNum'), 'change', () => {
      if (!this.config.search) {
        this.config.search = { enabled: false };
      }
      this.config.search.num = Number(($('searchNum') as HTMLSelectElement).value) || 5;
      this.saveConfig();
    });
  }

  private providerKey(baseUrl: string): string {
    const url = String(baseUrl || '');
    if (url.indexOf('deepseek') >= 0) {
      return 'deepseek';
    }
    if (url.indexOf('dashscope') >= 0) {
      return 'bailian';
    }
    if (url.indexOf('openai.com') >= 0) {
      return 'openai';
    }
    return url ? 'custom' : 'deepseek';
  }

  private saveConfig(): void {
    this.bridge.post('config.set', { config: this.config });
  }

  private changeFont(delta: number): void {
    const next = Math.min(22, Math.max(14, (Number(this.config.fontSize) || 16) + delta));
    this.config.fontSize = next;
    document.documentElement.style.setProperty('--msg-size', next + 'px');
    $('fontSizeValue').textContent = String(next);
    this.saveConfig();
  }

  private saveSettings(): void {
    const providerKey = $('providerSelect').value;
    const preset = PROVIDERS[providerKey];
    this.config.provider = preset ? preset.label : this.config.provider;
    this.config.baseUrl = String($('apiUrl').value || '').trim();
    this.config.port = Number($('apiPort').value) || 443;
    this.config.apiKey = String($('apiKey').value || '').trim();
    this.saveConfig();
  }

  /* ------------------------------------------------------------- think -- */

  private thinkingMode(): string {
    const mode = this.config.thinking && this.config.thinking.mode;
    return typeof mode === 'string' && mode ? mode : 'auto';
  }

  private thinkingPayload(): any {
    const level = Number(this.config.thinking.level) || 0;
    if (level <= 0) {
      return { enabled: false, level: 0, params: {} };
    }
    const mode = this.thinkingMode();
    if (mode === 'off') {
      return { enabled: false, level: level, params: {} };
    }
    const budget = THINK_BUDGET[level - 1] || 4096;
    if (mode === 'enable_thinking') {
      return { enabled: true, level: level, params: { enable_thinking: true, thinking_budget: budget } };
    }
    if (mode === 'thinking_budget') {
      return { enabled: true, level: level, params: { thinking_budget: budget } };
    }
    if (mode === 'reasoning_effort') {
      return { enabled: true, level: level, params: { reasoning_effort: LEVEL_API[level] } };
    }
    // auto: pick something sensible for the configured endpoint/model
    const model = String(this.config.model || '');
    if (/reasoner|r1|thinking|-think/i.test(model)) {
      // the model always reasons, no extra request field needed
      return { enabled: false, level: level, params: {} };
    }
    if (this.providerKey(this.config.baseUrl) === 'bailian' || /qwen|qwq/i.test(model)) {
      return { enabled: true, level: level, params: { enable_thinking: true, thinking_budget: budget } };
    }
    return { enabled: true, level: level, params: { reasoning_effort: LEVEL_API[level] } };
  }

  private updateThinkParamNote(): void {
    const note = $('thinkParamNote');
    if (!note) {
      return;
    }
    const payload = this.thinkingPayload();
    if (!payload.enabled) {
      note.textContent = '当前设置不会发送思考参数（模型自身思考或已关闭档位）';
      return;
    }
    const parts: string[] = [];
    for (const key in payload.params) {
      if (Object.prototype.hasOwnProperty.call(payload.params, key)) {
        parts.push(key + ' = ' + String(payload.params[key]));
      }
    }
    note.textContent = '本次请求会带上：' + parts.join('，');
  }

  private updateThinkChip(): void {
    const level = Number(this.config.thinking.level) || 0;
    this.config.thinking.enabled = level > 0;
    if (level > 0) {
      this.thinkChip.classList.add('is-on');
      this.thinkChip.setAttribute('aria-pressed', 'true');
      this.thinkLabel.textContent = '思考 · ' + LEVELS[level].name;
    } else {
      this.thinkChip.classList.remove('is-on');
      this.thinkChip.setAttribute('aria-pressed', 'false');
      this.thinkLabel.textContent = '思考';
    }
    this.updateThinkParamNote();
  }

  private renderThinkList(): void {
    const level = Number(this.config.thinking.level) || 0;
    this.thinkList.innerHTML = '';
    for (let i = 0; i < LEVELS.length; i++) {
      const lv = LEVELS[i];
      const item = el('button', 'model-item' + (lv.level === level ? ' is-selected' : '')) as HTMLButtonElement;
      item.type = 'button';
      item.appendChild(el('span', 'model-name', lv.name));
      item.appendChild(el('span', 'model-desc', lv.desc));
      item.appendChild(el('span', 'model-check', '✓'));
      this.on(item, 'click', () => {
        this.config.thinking.level = lv.level;
        this.updateThinkChip();
        this.saveConfig();
        this.closeOverlay($('thinkOverlay'));
        this.toast(lv.level ? '思考档位：' + lv.name : '已关闭思考');
      });
      this.thinkList.appendChild(item);
    }
  }

  private openThink(): void {
    this.renderThinkList();
    this.openOverlay($('thinkOverlay'));
  }

  /* ------------------------------------------------------------- models -- */

  private openModels(): void {
    if (!this.config.models || !this.config.models.length) {
      this.fetchModels(true);
    } else {
      this.renderModelList();
      this.openOverlay($('modelOverlay'));
    }
  }

  private renderModelList(): void {
    const list: string[] = this.config.models || [];
    this.modelList.innerHTML = '';
    for (let i = 0; i < list.length; i++) {
      const name = list[i];
      const item = el('button', 'model-item' + (name === this.config.model ? ' is-selected' : '')) as HTMLButtonElement;
      item.type = 'button';
      item.appendChild(el('span', 'model-name', name));
      item.appendChild(el('span', 'model-desc', name === this.config.model ? '当前模型' : ''));
      item.appendChild(el('span', 'model-check', '✓'));
      this.on(item, 'click', () => {
        this.config.model = name;
        this.modelChipName.textContent = name;
        this.saveConfig();
        this.closeOverlay($('modelOverlay'));
        this.toast('已切换：' + name);
      });
      this.modelList.appendChild(item);
    }
    this.modelCount.textContent = list.length + ' 个模型';
  }

  private fetchModels(openAfter?: boolean): void {
    const refresh = $('refreshModelsBtn');
    if (refresh) {
      refresh.textContent = '刷新中…';
    }
    this.modelsOpenAfter = !!openAfter;
    this.bridge.post('models.fetch');
  }

  private resetModelsBtn(): void {
    const refresh = $('refreshModelsBtn');
    if (refresh) {
      refresh.textContent = '刷新模型列表';
    }
  }

  private receiveModels(m: Msg): void {
    this.resetModelsBtn();
    const list = Array.isArray(m.models) ? m.models.filter((x: any) => typeof x === 'string' && x) : [];
    if (!list.length) {
      this.toast('没拿到模型列表');
      return;
    }
    this.config.models = list;
    if (list.indexOf(this.config.model) < 0) {
      this.config.model = list[0];
      this.modelChipName.textContent = this.config.model;
    }
    this.saveConfig();
    this.renderModelList();
    this.toast('模型已更新（' + list.length + '）');
    if (this.modelsOpenAfter) {
      this.modelsOpenAfter = false;
      this.openOverlay($('modelOverlay'));
    }
  }

  /* ------------------------------------------------------------- images -- */

  private pickImage(): void {
    this.bridge.post('image.pick', { source: 'library' });
  }

  private receiveImage(m: Msg): void {
    // native sends {type:'image', image:{mime, dataBase64, width, height}}
    const img = m && m.image && typeof m.image === 'object' ? m.image : m;
    if (!img || !img.dataBase64) {
      return;
    }
    this.attach = {
      dataBase64: String(img.dataBase64),
      mime: String(img.mime || 'image/jpeg'),
      bytes: Number(img.bytes) || 0
    };
    this.attachThumb.src = 'data:' + this.attach.mime + ';base64,' + this.attach.dataBase64;
    const w = Number(img.width) || 0;
    const h = Number(img.height) || 0;
    this.attachName.textContent = w && h ? w + ' × ' + h : formatBytes(this.attach.bytes || 0);
    // the attach row is only rendered when the composer carries `has-attach`
    this.composer.classList.add('has-attach');
    this.attachRow.classList.add('is-open');
    this.composer.classList.add('is-stacked');
    // small copy that is cheap enough to keep in the session archive
    this.makeThumb('data:' + this.attach.mime + ';base64,' + this.attach.dataBase64, 320, (thumb: string) => {
      if (this.attach) {
        this.attach.thumb = thumb;
      }
    });
    this.refreshSendState();
  }

  private makeThumb(src: string, max: number, done: (thumb: string) => void): void {
    const img = new Image();
    img.onload = () => {
      try {
        const w0 = img.width || max;
        const h0 = img.height || max;
        const scale = Math.min(1, max / Math.max(w0, h0));
        const w = Math.max(1, Math.round(w0 * scale));
        const h = Math.max(1, Math.round(h0 * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          done('');
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        const url = canvas.toDataURL('image/jpeg', 0.7);
        done(String(url).split(',')[1] || '');
      } catch (err) {
        done('');
      }
    };
    img.onerror = () => done('');
    img.src = src;
  }

  private clearAttach(): void {
    this.attach = null;
    this.composer.classList.remove('has-attach');
    this.attachRow.classList.remove('is-open');
    this.composer.classList.remove('is-stacked');
    this.attachThumb.removeAttribute('src');
    this.attachName.textContent = '';
    this.refreshSendState();
  }

  /* -------------------------------------------------------------- chat -- */

  private autogrow(): void {
    const ta = this.input;
    ta.style.height = 'auto';
    const h = Math.min(ta.scrollHeight, 132);
    ta.style.height = h + 'px';
  }

  private refreshSendState(): void {
    const has = this.input.value.trim().length > 0 || !!this.attach;
    if (has && !this.streaming) {
      this.sendBtn.removeAttribute('disabled');
    } else if (!this.streaming) {
      this.sendBtn.setAttribute('disabled', '');
    }
    if (this.streaming) {
      this.sendBtn.classList.add('is-stop');
    } else {
      this.sendBtn.classList.remove('is-stop');
    }
  }

  private enterChat(): void {
    if (this.app.classList.contains('chat')) {
      return;
    }
    this.app.classList.add('chat');
    this.dockHost.appendChild(this.composer);
    this.scrollToBottom(true);
  }

  private send(): void {
    const text = this.input.value.trim();
    if (!text && !this.attach) {
      return;
    }
    const image = this.attach
      ? { dataBase64: this.attach.dataBase64, mime: this.attach.mime, thumb: this.attach.thumb || '' }
      : null;

    const userMsg: Message = { id: uid(), role: 'user', content: text, image: image, ts: Date.now() };
    this.messages.push(userMsg);
    this.input.value = '';
    this.autogrow();
    this.clearAttach();
    this.enterChat();
    this.touchCurrent();
    this.renderAll();
    this.scrollToBottom(true);
    this.saveStore();

    this.requestId = uid();
    this.streaming = true;
    this.refreshSendState();

    const assistant: Message = { id: uid(), role: 'assistant', content: '', ts: Date.now() };
    this.messages.push(assistant);
    this.appendMessageEl(assistant, true);
    this.scrollToBottom(true);

    const thinking = this.thinkingPayload();

    this.bridge.post('chat.start', {
      requestId: this.requestId,
      config: this.config,
      messages: this.historyForApi(),
      image: image,
      thinking: thinking,
      search: { enabled: !!(this.config.search && this.config.search.enabled) }
    });
  }

  private stop(): void {
    if (!this.streaming) {
      return;
    }
    this.bridge.post('chat.stop', { requestId: this.requestId });
  }

  private historyForApi(): Array<{ role: string; content: string }> {
    const out: Array<{ role: string; content: string }> = [];
    for (let i = 0; i < this.messages.length; i++) {
      const m = this.messages[i];
      if (m.error) {
        continue;
      }
      // skip the empty assistant placeholder that is being streamed
      if (m.role === 'assistant' && !m.content && this.streaming && i === this.messages.length - 1) {
        continue;
      }
      if (m.content) {
        out.push({ role: m.role, content: m.content });
      }
    }
    return out;
  }

  private appendDelta(chunk: string): void {
    const last = this.messages[this.messages.length - 1];
    if (!last || last.role !== 'assistant') {
      return;
    }
    last.content += chunk;
    const wrap = this.threadInner.querySelector('[data-id="' + last.id + '"]') as HTMLElement | null;
    if (wrap && wrap.classList.contains('thinking')) {
      // first token: swap the "正在思考…" placeholder for the real reply body,
      // keeping any reasoning block that already arrived above it
      wrap.classList.remove('thinking');
      wrap.classList.add('is-streaming');
      const placeholder = wrap.querySelector('.thinking-body') as HTMLElement | null;
      if (placeholder && placeholder.parentNode) {
        placeholder.parentNode.removeChild(placeholder);
      }
      if (!wrap.querySelector('.ai-body')) {
        wrap.appendChild(el('div', 'ai-body'));
      }
    }
    this.scheduleStreamRender(last);
  }

  private appendReasoning(chunk: string): void {
    const last = this.messages[this.messages.length - 1];
    if (!last || last.role !== 'assistant') {
      return;
    }
    last.reasoning = (last.reasoning || '') + chunk;
    const wrap = this.threadInner.querySelector('[data-id="' + last.id + '"]') as HTMLElement | null;
    if (!wrap) {
      return;
    }
    let box = wrap.querySelector('.reasoning') as HTMLElement | null;
    if (!box) {
      box = el('div', 'reasoning');
      const head = el('div', 'reasoning-head', '思考过程');
      const body = el('div', 'reasoning-body');
      box.appendChild(head);
      box.appendChild(body);
      const target = box;
      this.on(head, 'click', () => {
        if (target.classList.contains('is-open')) {
          target.classList.remove('is-open');
        } else {
          target.classList.add('is-open');
        }
      });
      wrap.insertBefore(box, wrap.firstChild);
    }
    const body = box.querySelector('.reasoning-body') as HTMLElement | null;
    if (body) {
      body.textContent = last.reasoning;
    }
    this.scrollToBottom(false);
  }

  private scheduleStreamRender(msg: Message): void {
    if (this.renderTimer) {
      return;
    }
    this.renderTimer = window.setTimeout(() => {
      this.renderTimer = 0;
      const node = this.threadInner.querySelector('[data-id="' + msg.id + '"] .ai-body') as HTMLElement | null;
      if (node) {
        node.innerHTML = renderMarkdown(msg.content);
        this.scrollToBottom(false);
      }
    }, 120);
  }

  private finish(ok: boolean): void {
    if (!this.streaming) {
      return;
    }
    this.streaming = false;
    this.refreshSendState();
    const last = this.messages[this.messages.length - 1];
    if (last && last.role === 'assistant') {
      const node = this.threadInner.querySelector('[data-id="' + last.id + '"]') as HTMLElement | null;
      if (node) {
        node.classList.remove('is-streaming');
        const body = node.querySelector('.ai-body') as HTMLElement | null;
        if (body) {
          body.innerHTML = renderMarkdown(last.content || (ok ? '' : '（已停止）'));
        }
        const rbox = node.querySelector('.reasoning') as HTMLElement | null;
        if (rbox) {
          rbox.classList.remove('is-open');
          rbox.classList.add('is-done');
          const head = rbox.querySelector('.reasoning-head') as HTMLElement | null;
          const chars = (last.reasoning || '').length;
          if (head && chars) {
            head.textContent = '思考过程 · ' + chars + ' 字（点按展开）';
          }
        }
      }
      if (!last.content) {
        last.content = ok ? '（空回复）' : '（已停止）';
      }
    }
    this.touchCurrent();
    this.saveStore();
    this.scrollToBottom(true);
  }

  private fail(message: string): void {
    this.streaming = false;
    this.refreshSendState();
    const last = this.messages[this.messages.length - 1];
    const node = last ? (this.threadInner.querySelector('[data-id="' + last.id + '"]') as HTMLElement | null) : null;
    if (last && last.role === 'assistant') {
      last.content = last.content || '';
      last.error = true;
      this.messages.pop();
      if (node && node.parentNode) {
        node.parentNode.removeChild(node);
      }
    }
    const box = el('div', 'msg ai');
    const body = el('div', 'msg-error', message);
    const retry = el('button', 'retry-btn', '重试') as HTMLButtonElement;
    retry.type = 'button';
    this.on(retry, 'click', () => {
      if (box.parentNode) {
        box.parentNode.removeChild(box);
      }
      this.resendLast();
    });
    box.appendChild(body);
    box.appendChild(retry);
    this.threadInner.appendChild(box);
    this.touchCurrent();
    this.saveStore();
    this.scrollToBottom(true);
  }

  private resendLast(): void {
    // drop the failed assistant bubble, put the user text back and send again
    while (this.messages.length && this.messages[this.messages.length - 1].role === 'assistant') {
      this.messages.pop();
    }
    const last = this.messages[this.messages.length - 1];
    if (!last || last.role !== 'user') {
      this.renderAll();
      return;
    }
    const text = last.content;
    this.messages.pop();
    this.renderAll();
    this.input.value = text;
    this.autogrow();
    this.refreshSendState();
    this.send();
  }

  /* ------------------------------------------------------------- render -- */

  private renderAll(): void {
    this.threadInner.innerHTML = '';
    if (!this.messages.length) {
      this.app.classList.remove('chat');
      this.heroComposer.appendChild(this.composer);
    } else {
      this.enterChat();
    }
    for (let i = 0; i < this.messages.length; i++) {
      const m = this.messages[i];
      if (m.role === 'assistant' && !m.content && i === this.messages.length - 1) {
        this.appendMessageEl(m, true);
      } else {
        this.appendMessageEl(m, false);
      }
    }
    this.refreshSendState();
  }

  private renderSources(items: any): void {
    if (!Array.isArray(items) || !items.length) {
      return;
    }
    const last = this.messages[this.messages.length - 1];
    if (!last) {
      return;
    }
    const wrap = this.threadInner.querySelector('[data-id="' + last.id + '"]') as HTMLElement | null;
    if (!wrap) {
      return;
    }
    const old = wrap.querySelector('.sources');
    if (old) {
      old.parentNode!.removeChild(old);
    }
    const box = el('div', 'sources');
    box.appendChild(el('div', 'sources-head', '来源 · 点击用 Safari 打开'));
    const list = el('ol', 'sources-list');
    for (let i = 0; i < items.length; i++) {
      const item = items[i] || {};
      const li = el('li', 'source-item') as HTMLElement;
      const link = el('a', 'source-link', String(item.title || item.url || '来源')) as HTMLAnchorElement;
      link.href = String(item.url || '');
      link.setAttribute('target', '_blank');
      link.setAttribute('rel', 'noopener noreferrer');
      li.appendChild(link);
      if (item.url) {
        const host = el('span', 'source-host', String(item.url).replace(/^https?:\/\//, '').split('/')[0]);
        li.appendChild(host);
      }
      list.appendChild(li);
    }
    box.appendChild(list);
    wrap.appendChild(box);
  }

  private appendMessageEl(msg: Message, streaming: boolean): void {
    if (msg.role === 'user') {
      const wrap = el('div', 'msg user');
      wrap.setAttribute('data-id', msg.id);
      if (msg.image && (msg.image.thumb || msg.image.dataBase64)) {
        const img = el('img', 'bubble-img') as HTMLImageElement;
        img.src = msg.image.thumb
          ? 'data:image/jpeg;base64,' + msg.image.thumb
          : 'data:' + (msg.image.mime || 'image/jpeg') + ';base64,' + msg.image.dataBase64;
        wrap.appendChild(img);
      }
      if (msg.content) {
        wrap.appendChild(el('div', 'bubble', msg.content));
      }
      this.threadInner.appendChild(wrap);
      return;
    }

    const wrap = el('div', 'msg ai' + (streaming && !msg.content ? ' thinking' : ''));
    wrap.setAttribute('data-id', msg.id);

    const body = el('div', 'ai-body');
    if (streaming && !msg.content) {
      const dots = el('span', 'thinking-dots');
      dots.appendChild(el('i'));
      dots.appendChild(el('i'));
      dots.appendChild(el('i'));
      const label = el('span', 'thinking-label', '正在思考…');
      const row = el('div', 'thinking-body');
      row.appendChild(dots);
      row.appendChild(label);
      wrap.appendChild(row);
      this.threadInner.appendChild(wrap);
      return;
    }
    body.innerHTML = renderMarkdown(msg.content || '');
    wrap.appendChild(body);
    this.threadInner.appendChild(wrap);
  }

  private scrollToBottom(force: boolean): void {
    const node = this.thread;
    if (!node) {
      return;
    }
    const nearBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 120;
    if (force || nearBottom) {
      node.scrollTop = node.scrollHeight;
    }
  }

  /* -------------------------------------------------------------- store -- */

  private saveStore(): void {
    if (this.saveTimer) {
      window.clearTimeout(this.saveTimer);
    }
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = 0;
      const sessions = this.sessions.map((s) => ({
        id: s.id,
        title: s.title,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        messages: s.messages.slice(-120).map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          image: m.image && m.image.thumb
            ? { mime: m.image.mime || 'image/jpeg', thumb: m.image.thumb }
            : null,
          ts: m.ts || 0
        }))
      }));
      this.bridge.post('store.save', { data: { v: 2, sessions: sessions, currentId: this.currentId } });
    }, 700);
  }

  /* ----------------------------------------------------------- sessions -- */

  private current(): Session | null {
    for (let i = 0; i < this.sessions.length; i++) {
      if (this.sessions[i].id === this.currentId) {
        return this.sessions[i];
      }
    }
    return this.sessions.length ? this.sessions[0] : null;
  }

  private makeSession(messages: Message[]): Session {
    const now = Date.now();
    return {
      id: 's' + now.toString(36) + Math.random().toString(36).slice(2, 6),
      title: this.titleFor(messages),
      createdAt: now,
      updatedAt: now,
      messages: messages
    };
  }

  private normalizeMessages(list: any): Message[] {
    return (Array.isArray(list) ? list : [])
      .filter((m: any) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .map((m: any) => {
        const raw = m.image && typeof m.image === 'object' ? m.image : null;
        const thumb = raw && typeof raw.thumb === 'string' ? raw.thumb : '';
        const data = raw && typeof raw.dataBase64 === 'string' ? raw.dataBase64 : '';
        const image = raw && (thumb || data)
          ? { mime: String(raw.mime || 'image/jpeg'), thumb: thumb, dataBase64: data }
          : null;
        return { id: m.id || uid(), role: m.role, content: m.content, image: image, ts: m.ts || 0 };
      });
  }

  private loadSessions(data: any): void {
    const raw = Array.isArray(data.sessions) ? data.sessions : null;
    const loaded: Session[] = [];
    if (raw) {
      for (let i = 0; i < raw.length; i++) {
        const s = raw[i];
        if (!s || typeof s !== 'object') {
          continue;
        }
        const msgs = this.normalizeMessages(s.messages || []);
        const now = Date.now();
        loaded.push({
          id: typeof s.id === 'string' && s.id ? s.id : 's' + now.toString(36) + i,
          title: typeof s.title === 'string' && s.title ? s.title : this.titleFor(msgs),
          createdAt: Number(s.createdAt) || now,
          updatedAt: Number(s.updatedAt) || now,
          messages: msgs
        });
      }
    } else {
      const legacy = this.normalizeMessages(data.messages || []);
      if (legacy.length) {
        loaded.push(this.makeSession(legacy));
      }
    }
    this.sessions = loaded.length ? loaded : [this.makeSession([])];
    const wanted = typeof data.currentId === 'string' ? data.currentId : '';
    let active = this.sessions[0];
    for (let i = 0; i < this.sessions.length; i++) {
      if (this.sessions[i].id === wanted) {
        active = this.sessions[i];
      }
    }
    this.currentId = active.id;
    this.messages = active.messages;
  }

  private titleFor(messages: Message[]): string {
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i];
      if (m.role === 'user' && m.content && m.content.trim()) {
        const text = m.content.replace(/\s+/g, ' ').trim();
        return text.length > 22 ? text.slice(0, 22) + '…' : text;
      }
    }
    return '新对话';
  }

  private touchCurrent(): void {
    const s = this.current();
    if (!s) {
      return;
    }
    s.updatedAt = Date.now();
    s.title = this.titleFor(s.messages);
    if (this.drawerLayer && this.drawerLayer.classList.contains('is-open')) {
      this.renderSessions();
    }
  }

  private sessionTime(ts: number): string {
    const d = new Date(ts || Date.now());
    const now = new Date();
    const sameDay = (a: Date, b: Date) =>
      a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    if (sameDay(d, now)) {
      return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
    }
    const yesterday = new Date(now.getTime() - 86400000);
    if (sameDay(d, yesterday)) {
      return '昨天';
    }
    if (d.getFullYear() === now.getFullYear()) {
      return d.getMonth() + 1 + '月' + d.getDate() + '日';
    }
    return d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate();
  }

  private renderSessions(): void {
    if (!this.sessionList) {
      return;
    }
    this.sessionList.innerHTML = '';
    const sorted = this.sessions.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    let lastGroup = '';
    for (let i = 0; i < sorted.length; i++) {
      const s = sorted[i];
      const group = this.groupFor(s.updatedAt);
      if (group !== lastGroup) {
        this.sessionList.appendChild(el('div', 'session-group', group));
        lastGroup = group;
      }
      const row = el('div', 'session-row' + (s.id === this.currentId ? ' is-active' : '') + (s.id === this.openRowId ? ' is-open' : ''));
      row.setAttribute('data-id', s.id);

      const actions = el('div', 'session-actions');
      const rename = el('button', 'session-act', '重命名') as HTMLButtonElement;
      rename.type = 'button';
      const del = el('button', 'session-act is-danger', '删除') as HTMLButtonElement;
      del.type = 'button';
      actions.appendChild(rename);
      actions.appendChild(del);

      const content = el('button', 'session-content') as HTMLButtonElement;
      content.type = 'button';
      content.appendChild(el('span', 'session-title', s.title || '新对话'));
      content.appendChild(el('span', 'session-time', this.sessionTime(s.updatedAt)));

      row.appendChild(actions);
      row.appendChild(content);
      this.sessionList.appendChild(row);
      this.bindRowGesture(content, actions, s.id);
    }
  }

  private groupFor(ts: number): string {
    const value = ts || 0;
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    if (value >= startOfToday) {
      return '今天';
    }
    if (value >= startOfToday - 6 * 86400000) {
      return '近 7 天';
    }
    return '更早';
  }

  private setOpenRow(id: string): void {
    this.openRowId = id;
    if (!this.sessionList) {
      return;
    }
    const rows = this.sessionList.querySelectorAll('.session-row') as any;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] as HTMLElement;
      const rowId = row.getAttribute('data-id') || '';
      if (!!id && rowId === id) {
        row.classList.add('is-open');
      } else {
        row.classList.remove('is-open');
      }
      const content = row.querySelector('.session-content') as HTMLElement | null;
      if (content) {
        content.style.transform = '';
      }
    }
  }

  private bindRowGesture(content: HTMLElement, actions: HTMLElement, id: string): void {
    const WIDTH = 136;
    const THRESH = 30;
    let startX = 0;
    let startY = 0;
    let dx = 0;
    let dy = 0;
    let active = false;
    let moving = false;
    let swiped = false;

    const resetActions = () => {
      actions.style.transition = '';
      actions.style.transform = '';
      actions.style.opacity = '';
    };
    const begin = (x: number, y: number) => {
      startX = x;
      startY = y;
      dx = 0;
      dy = 0;
      active = true;
      moving = false;
      swiped = false;
    };
    const move = (x: number, y: number) => {
      if (!active) {
        return;
      }
      dx = x - startX;
      dy = y - startY;
      if (!moving && Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) {
        // vertical scroll wins over the swipe
        active = false;
        resetActions();
        return;
      }
      if (!moving && Math.abs(dx) > 6) {
        moving = true;
      }
      if (moving) {
        const base = this.openRowId === id ? -WIDTH : 0;
        const offset = Math.min(0, Math.max(-WIDTH, base + dx));
        const reveal = -offset;
        actions.style.transition = 'none';
        actions.style.transform = 'translateX(' + (WIDTH - reveal) + 'px)';
        actions.style.opacity = String(Math.min(1, reveal / WIDTH));
      }
    };
    const end = () => {
      if (!active) {
        return;
      }
      active = false;
      resetActions();
      if (moving && Math.abs(dx) > 8) {
        swiped = true;
        if (dx < -THRESH) {
          this.setOpenRow(id);
        } else if (dx > THRESH) {
          this.setOpenRow('');
        } else {
          this.setOpenRow(this.openRowId === id ? '' : id);
        }
      }
    };

    // a swipe must not be turned into a tap by the synthetic click
    content.addEventListener('click', (e: any) => {
      if (swiped) {
        swiped = false;
        e.stopPropagation();
        e.preventDefault();
      }
    }, true);

    content.addEventListener('touchstart', (e: any) => {
      const t = e.touches[0];
      begin(t.clientX, t.clientY);
    }, false);
    content.addEventListener('touchmove', (e: any) => {
      const t = e.touches[0];
      if (moving && e.cancelable) {
        e.preventDefault();
      }
      move(t.clientX, t.clientY);
    }, { passive: false } as any);
    content.addEventListener('touchend', end, false);
    content.addEventListener('touchcancel', end, false);
    content.addEventListener('mousedown', (e: any) => begin(e.clientX, e.clientY), false);
    content.addEventListener('mousemove', (e: any) => {
      if (active) {
        move(e.clientX, e.clientY);
      }
    }, false);
    content.addEventListener('mouseup', end, false);
    content.addEventListener('mouseleave', end, false);
  }

  private startRename(row: HTMLElement, id: string): void {
    let target: Session | null = null;
    for (let i = 0; i < this.sessions.length; i++) {
      if (this.sessions[i].id === id) {
        target = this.sessions[i];
      }
    }
    if (!target) {
      return;
    }
    const session = target;
    this.setOpenRow('');
    while (row.firstChild) {
      row.removeChild(row.firstChild);
    }
    row.className = 'session-row is-renaming';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'session-rename';
    input.setAttribute('maxlength', '40');
    input.value = session.title === '新对话' ? '' : session.title;
    row.appendChild(input);
    input.focus();
    input.setSelectionRange(0, input.value.length);

    let done = false;
    const commit = (save: boolean) => {
      if (done) {
        return;
      }
      done = true;
      if (save) {
        const text = input.value.replace(/\s+/g, ' ').trim();
        session.title = text ? text.slice(0, 40) : this.titleFor(session.messages);
        this.saveStore();
      }
      this.renderSessions();
    };
    input.addEventListener('keydown', (e: any) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commit(true);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        commit(false);
      }
    }, false);
    input.addEventListener('blur', () => commit(true), false);
  }

  private openDrawer(): void {
    this.openRowId = '';
    this.renderSessions();
    this.drawerLayer.classList.add('is-open');
    this.drawerLayer.setAttribute('aria-hidden', 'false');
  }

  private closeDrawer(): void {
    this.openRowId = '';
    this.drawerLayer.classList.remove('is-open');
    this.drawerLayer.setAttribute('aria-hidden', 'true');
  }

  private switchSession(id: string): void {
    if (id === this.currentId) {
      this.closeDrawer();
      return;
    }
    let next: Session | null = null;
    for (let i = 0; i < this.sessions.length; i++) {
      if (this.sessions[i].id === id) {
        next = this.sessions[i];
      }
    }
    if (!next) {
      return;
    }
    if (this.streaming) {
      this.stop();
    }
    this.currentId = next.id;
    this.messages = next.messages;
    this.renderAll();
    this.closeDrawer();
    this.saveStore();
  }

  private deleteSession(id: string): void {
    let idx = -1;
    for (let i = 0; i < this.sessions.length; i++) {
      if (this.sessions[i].id === id) {
        idx = i;
      }
    }
    if (idx < 0) {
      return;
    }
    const wasCurrent = id === this.currentId;
    if (this.openRowId === id) {
      this.openRowId = '';
    }
    this.sessions.splice(idx, 1);
    if (!this.sessions.length) {
      this.sessions.push(this.makeSession([]));
    }
    if (wasCurrent) {
      if (this.streaming) {
        this.stop();
      }
      const next = this.sessions[this.sessions.length - 1];
      this.currentId = next.id;
      this.messages = next.messages;
      this.renderAll();
    }
    this.renderSessions();
    this.saveStore();
    this.toast('已删除会话');
  }

  private newChat(): void {
    if (this.streaming) {
      this.stop();
    }
    const cur = this.current();
    if (cur && cur.messages.length === 0) {
      this.closeDrawer();
      this.renderAll();
      return;
    }
    const s = this.makeSession([]);
    this.sessions.push(s);
    this.currentId = s.id;
    this.messages = s.messages;
    this.renderAll();
    this.closeDrawer();
    this.saveStore();
    this.toast('新对话');
  }

  private clearAll(): void {
    const s = this.current();
    if (s) {
      s.messages = [];
      s.title = '新对话';
      s.updatedAt = Date.now();
      this.messages = s.messages;
    }
    this.renderAll();
    this.saveStore();
    this.closeOverlay($('settingsOverlay'));
    this.toast('已清空当前对话');
  }

  /* -------------------------------------------------------------- sheets -- */

  private openOverlay(node: HTMLElement): void {
    node.classList.add('is-open');
    node.setAttribute('aria-hidden', 'false');
  }

  private closeOverlay(node: HTMLElement): void {
    node.classList.remove('is-open');
    node.setAttribute('aria-hidden', 'true');
  }

  private openSettings(): void {
    this.applyConfig();
    this.updateSettingsNote();
    this.openOverlay($('settingsOverlay'));
  }

  private setBuildInfo(build: string): void {
    this.buildInfo = build;
    this.updateSettingsNote();
  }

  private updateSettingsNote(): void {
    const note = document.querySelector('#settingsOverlay .sheet-note') as HTMLElement | null;
    if (!note) {
      return;
    }
    note.textContent = '版本 ' + (this.buildInfo || 'unknown') + ' · 配置仅保存在本机';
  }

  private toast(text: string): void {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('is-visible');
    if (this.toastTimer) {
      window.clearTimeout(this.toastTimer);
    }
    this.toastTimer = window.setTimeout(() => {
      this.toastEl.classList.remove('is-visible');
    }, 1600);
  }
}