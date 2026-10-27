# ChatAI 正式界面规格（已确认）

> 用户 2026-10-27 确认：**白底浅色版（方向 D）**，布局沿用石墨版 C 的结构；
> 去掉首屏底注「无登录 · 对话仅保存在本机」；**「思考」改为档位选择**（不是开关）。
> 本文是正式 App（TS + 原生壳）的实现依据；原型见 `web/prototypes/d/index.html`，
> 截图见 `web/prototypes/shots/d-*.png`。

## 1. 整体结构

单页、无路由、无历史侧栏、无登录。

```
.app (fixed, 100%, flex column, overflow hidden)
├─ header.topbar            58px 高，底边 1px 细线
│   ├─ .wordmark            "对话"（13px，字距 2px，fg-faint）
│   └─ .topbar-actions
│       ├─ 新对话（仅对话态出现，ghost 按钮）
│       └─ 设置齿轮（40×40 圆形 icon-btn）
├─ main.stage (flex:1, min-height:0)
│   ├─ section.hero         首屏（无对话时）
│   │   ├─ h1.greeting      "需要我为你做些什么？"（38px 窄屏 / 45px ≥900px，weight 500）
│   │   └─ .hero-composer   宽度 max 680px，内含同一个 composer 组件
│   └─ section.thread       对话态（flex:1, overflow-y:auto, -webkit-overflow-scrolling:touch）
│       └─ .thread-inner    max 720px 居中
├─ footer.dock              对话态底部固定输入区（max 720px 居中）
│   └─ .composer            胶囊输入框
└─ overlays                 .overlay + .sheet（居中卡片，点击遮罩关闭）
    ├─ 模型选择（460px 宽）
    ├─ 思考档位（460px 宽）
    └─ 设置（460px 宽）
```

## 2. 输入胶囊（composer）

一行 flex：`+`（40×40）→ textarea（flex:1，1–132px 自适应，字号 17/行高 24）→ 右侧工具区。

右侧工具：
1. **模型 chip**：当前模型名（最长 132px 省略）+ ▾；点击打开「模型选择」弹层。
2. **思考 chip**：圆点 + 文字；点击打开「思考档位」弹层。
   - 关闭时：文字「思考」，无高亮。
   - 开档位时：文字「思考 · 低/中/高」，chip 用暖沙高亮（`--think-on-*`）。
3. **发送键**：44×44 圆形；空输入时禁用（浅灰），有输入时深色实心（`--send-bg`）。

有附件时 composer 变 `is-stacked`（圆角 30px），上方多一行缩略图 + 文件名 + 移除按钮。

## 3. 思考档位（本次修改）

点「思考」chip 弹出居中卡片「思考档位」，4 个选项（复用模型列表样式）：

| 档位 | 名称 | 说明文案 | API 映射 |
| --- | --- | --- | --- |
| 0 | 关闭 | 不启用思考，响应最快 | 不传思考参数 |
| 1 | 低 | 简短思考，适合日常问答 | `reasoning_effort: "low"` |
| 2 | 中 | 深度与速度平衡 | `reasoning_effort: "medium"` |
| 3 | 高 | 充分推理，复杂任务 | `reasoning_effort: "high"` |

- 默认档位：**关闭**。
- 其他 provider 的映射可通过设置里的自定义参数覆盖（如 Qwen `enable_thinking: true` + `thinking_budget`）。
- 选中项：暖沙底 + 边框 + 右侧 ；页脚提示「档位越高，推理越充分，也越慢」。

## 4. 首屏 / 对话态

- 首屏：问候语 + 胶囊居中（垂直略偏上）；无底注。
- 发送第一条后切到对话态：`.hero` 隐藏，`.thread` 显示，`.dock` 固定在底部；顶栏出现「新对话」。
- 消息：用户消息右对齐、灰底气泡（`--user-bubble-bg`，圆角 18px，右下角 8px）；
  AI 回复左侧纯文本（`--ai-fg`），支持 Markdown（标题/列表/粗体/行内代码/代码块）。
- AI 生成中显示「正在思考…」三点动画；完成后替换为正文；滚动跟随到底部（无动画）。

## 4.5 会话抽屉（session 归档，2026-10-28 新增）

- **入口**：顶栏最左侧汉堡按钮（40px 热区）→ 抽屉从左边滑出。
- **结构**：抽屉宽 296px（`max-width: 82vw`），白底、右侧 1px 分隔线 + 投影；
  遮罩 `rgba(24,24,20,.30)`；点击遮罩 / 右上角 × / Esc 关闭。
- **内容**：标题「会话」→ 列表（按最近更新时间倒序、按 `今天 / 近 7 天 / 更早` 分段）
  → 底部提示「左滑会话可重命名或删除」+「＋ 新对话」。
- **单行**：标题 = 首条用户消息（压缩空白，超过 22 字截断加省略号，空会话显示「新对话」）
  + 时间（今天 `HH:mm` / `昨天` / `M月D日` / `YYYY/M/D`）。
- **高亮**：当前会话行底 `rgba(185,138,75,.11)`。
- **左滑操作**：行内容左滑 → 右侧滑出「重命名 / 删除」两个按钮（内容同时缩短省略，不遮字）；
  右滑或点行收起；同一时间只展开一行；纵向手势优先给列表滚动。
- **重命名**：点「重命名」→ 行内变成输入框（预填当前标题、全选、最多 40 字）；
  Enter 或点空白保存，Esc 取消；留空则回落到首条用户消息。
- **行为**：
  - 点行 → 切换到该会话（关抽屉、恢复消息、清空输入框状态）；
  - 「删除」→ 直接删除（不做二次确认）；删的若是当前会话，则切到最近一条，没有就新建空会话；
  - 「＋ 新对话」/ 顶栏「新对话」→ 当前会话为空时只关抽屉，否则新建并切换。
- **持久化**（`store.json`）：`{v:2, sessions:[{id,title,createdAt,updatedAt,messages}], currentId}`；
  每会话最多保留最近 120 条；图片不落盘（重开只恢复文本）；保存 700ms 防抖。
- **迁移**：旧数据 `{messages:[…]}` 自动变成单会话。

## 5. 设置弹层

顺序：消息字号（A- / 数值 / A+，14–22，默认 16）→ API 提供商（OpenAI / DeepSeek / 阿里云百炼 / 自定义）
→ API 地址 + 端口 → API Key → 「刷新模型列表」→ 分隔线 → 「清空对话」→ 提示「配置仅保存在本机」。

## 6. 视觉 token（浅色 / 方向 D）

| token | 值 |
| --- | --- |
| `--bg` / 背景 | `#f6f6f2` + 顶部径向白光 + 180° 线性（`#fbfbf8 → #f3f3ee → #edede7`） |
| `--fg` | `#1b1d1a`；dim `rgba(27,29,26,.62)`；faint `rgba(27,29,26,.38)` |
| 顶栏分隔 | `rgba(0,0,0,.07)` |
| 胶囊 surface | `#ffffff`，边框 `rgba(0,0,0,.08)`，阴影 `0 14px 34px rgba(23,24,20,.10)` |
| chip | 底 `#f0f0ea`，边 `rgba(0,0,0,.06)`，字 `#33362f` |
| 强调色 accent | `#b98a4b`（暖沙）；思考开启底 `rgba(185,138,75,.14)` |
| 发送键 | 深色 `#22241f`，字 `#f7f7f3`；禁用底 `rgba(0,0,0,.06)` |
| 用户气泡 | `#e9e9e1` / 字 `#1e201c` |
| AI 正文 | `rgba(24,26,22,.9)`，强调 `#111310` |
| 遮罩 / 卡片 | `rgba(24,24,20,.32)` / `#ffffff`，圆角 20px |
| 代码 | 底 `rgba(0,0,0,.05)`，字 `#7a5a2e` |

## 7. iOS 10.3 / Safari 10.1 约束（实现时必须遵守）

- 允许：CSS 变量、flex、`-webkit-` 前缀、ES2015、Promise、async/await、`fetch`。
- 禁用：可选链 `?.`、空值合并 `??`、BigInt、`Array.flat`、`Object.fromEntries`、
  `String.replaceAll`、`Promise.finally/allSettled`、`AbortController`、flex `gap`、
  **CSS `inset` 简写**（用 `top/right/bottom/left`）、`classList.toggle` 的 force 参数、
  `backdrop-filter` 实时模糊、`dvh/svh`、`aspect-ratio`、`:has`、`scroll-behavior:smooth`、
  `position: sticky`。
  > `web/build.mjs` 会在构建时扫描 CSS，命中以上特性直接报错（2026-10-28 加，起因：抽屉用了
  > `inset:0`，iOS 10 上遮罩/抽屉高度塌成 0，整块 UI 挤在左上角）。
- 输入框 `font-size` 不小于 16px（避免聚焦自动放大）；`textarea` 需要手动同步高度。
- 滚动容器用 `-webkit-overflow-scrolling: touch`；单页 `overflow:hidden`，只让消息区滚。

## 8. 与原生桥的对应

| UI 动作 | 桥消息 |
| --- | --- |
| 启动 | 原生 → `ready`；Web 发 `config.get`、`store.load` |
| 发送 | `chat.start`（messages、image、thinking 档位、config） |
| 停止 | `chat.stop` |
| 刷新模型 | `models.fetch` |
| 设置保存 | `config.set` |
| 清空对话 | `store.save`（当前会话置空，保留会话本身） |
| 切换 / 新建 / 删除会话 | `store.save`（v2 结构：sessions + currentId） |
| 选图 | `image.pick` → 原生回 `image` |
| 键盘弹起 | 原生 → `keyboard {height}`，Web 调 dock 底部 padding |

协议细节见 `docs/bridge-protocol.md`。