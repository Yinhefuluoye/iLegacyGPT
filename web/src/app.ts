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
  image?: { dataBase64: string; mime: string } | null;
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
  private requestId = '';
  private streaming = false;
  private attach: { dataBase64: string; mime: string; bytes?: number } | null = null;
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
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
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
        return;
      }
      const id = row.getAttribute('data-id') || '';
      if (!id) {
        return;
      }
      if (target.classList && target.classList.contains('session-del')) {
        this.deleteSession(id);
        return;
      }
      this.switchSession(id);
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
      const h = Math.max(0, Number(m.height) || 0);
      document.documentElement.style.setProperty('--kb', h + 'px');
      this.scrollToBottom(true);
    });
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
      thinking: {
        level: Number((cfg.thinking && cfg.thinking.level) || 0),
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
    if (!this.bridge.native) {
      const input = $('fileInput') as HTMLInputElement;
      if (input) {
        input.click();
      }
      return;
    }
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
    this.attachName.textContent = formatBytes(this.attach.bytes || 0);
    this.attachRow.classList.add('is-open');
    this.composer.classList.add('is-stacked');
    this.refreshSendState();
  }

  private clearAttach(): void {
    this.attach = null;
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
    this.sendBtn.classList.toggle('is-stop', this.streaming);
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
    const image = this.attach ? { dataBase64: this.attach.dataBase64, mime: this.attach.mime } : null;

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

    const level = Number(this.config.thinking.level) || 0;
    const thinking = {
      enabled: level > 0,
      level: level,
      param: this.config.thinking.param || 'reasoning_effort',
      onValue: LEVEL_API[level] || '',
      offValue: ''
    };

    this.bridge.post('chat.start', {
      requestId: this.requestId,
      config: this.config,
      messages: this.historyForApi(),
      image: image,
      thinking: thinking
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
      // first token: swap the "正在思考…" placeholder for the real reply body
      wrap.classList.remove('thinking');
      wrap.classList.add('is-streaming');
      while (wrap.firstChild) {
        wrap.removeChild(wrap.firstChild);
      }
      wrap.appendChild(el('div', 'ai-body'));
    }
    this.scheduleStreamRender(last);
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

  private appendMessageEl(msg: Message, streaming: boolean): void {
    if (msg.role === 'user') {
      const wrap = el('div', 'msg user');
      wrap.setAttribute('data-id', msg.id);
      if (msg.image && msg.image.dataBase64) {
        const img = el('img', 'bubble-img') as HTMLImageElement;
        img.src = 'data:' + (msg.image.mime || 'image/jpeg') + ';base64,' + msg.image.dataBase64;
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
      .map((m: any) => ({ id: m.id || uid(), role: m.role, content: m.content, image: m.image || null, ts: m.ts || 0 }));
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
    for (let i = 0; i < sorted.length; i++) {
      const s = sorted[i];
      const row = el('div', 'session-row' + (s.id === this.currentId ? ' is-active' : ''));
      row.setAttribute('data-id', s.id);
      const item = el('button', 'session-item') as HTMLButtonElement;
      item.type = 'button';
      item.appendChild(el('span', 'session-title', s.title || '新对话'));
      item.appendChild(el('span', 'session-time', this.sessionTime(s.updatedAt)));
      const del = el('button', 'session-del', '×') as HTMLButtonElement;
      del.type = 'button';
      del.setAttribute('aria-label', '删除会话');
      row.appendChild(item);
      row.appendChild(del);
      this.sessionList.appendChild(row);
    }
  }

  private openDrawer(): void {
    this.renderSessions();
    this.drawerLayer.classList.add('is-open');
    this.drawerLayer.setAttribute('aria-hidden', 'false');
  }

  private closeDrawer(): void {
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
    const note = document.querySelector('#settingsOverlay .sheet-note') as HTMLElement | null;
    if (note) {
      note.textContent = '配置仅保存在本机';
    }
    this.openOverlay($('settingsOverlay'));
  }

  private setBuildInfo(build: string): void {
    const foot = document.querySelector('#settingsOverlay .sheet-foot .foot-note') as HTMLElement | null;
    if (foot) {
      foot.textContent = '版本 ' + build + ' · 配置仅保存在本机';
    }
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