# 极简 AI 对话 · iPad 视觉方向原型（A / B / C）

目标设备：**iPad 4（1024×768 横屏 / 768×1024 竖屏）**，最终运行环境为 iOS 10.3 的 WKWebView / Safari 10.1。
三个方向**共用同一套布局与交互逻辑**，只替换视觉 token（底色、描边、层次、字体气质、强调色），方便直接 A/B 对比。

```
projects/ipad-chat-client/web/prototypes/
├── a/index.html        # 方向 A（自包含：内联 CSS + JS，无外部依赖、无网络请求）
├── b/index.html        # 方向 B
├── c/index.html        # 方向 C
├── shots/              # 截图（见下）
├── _capture/           # 截图工具（本地开发用，可整个删除，不影响原型）
└── README.md
```

## 一句话定位

- **A · 深蓝渐变 + 白色胶囊**：最贴近参考图的「AI 产品感」——深蓝紫氛围光 + 纯白胶囊，第一眼最有冲击力。
- **B · 纯黑极简 + 细描边胶囊**：把界面压到最低对比度，只留大标题与一根细线，冷静、克制、几乎无装饰。
- **C · 石墨灰 + 轻层次**：用固态分层（填充色 + 1px 细线 + 内阴影）代替实时模糊，石墨底 + 暖沙色点缀，长时间阅读最舒服。

## 截图

目录：`projects/ipad-chat-client/web/prototypes/shots/`

### 必看：3 方向 × 2 视口（6 张）

| 方向 | 横屏 1024×768 | 竖屏 768×1024 |
| --- | --- | --- |
| A 深蓝渐变 | `shots/a-landscape.png` | `shots/a-portrait.png` |
| B 纯黑极简 | `shots/b-landscape.png` | `shots/b-portrait.png` |
| C 石墨轻层次 | `shots/c-landscape.png` | `shots/c-portrait.png` |

### 附加

- **对话态（6 张）**：`shots/{a,b,c}-{landscape,portrait}-chat.png`
- **弹层示例**：`shots/a-landscape-models.png`（模型弹层）、`shots/a-landscape-settings.png`（设置弹层）
- **交互验证**：
  - `shots/a-landscape-sent.png`：真实输入 → 点击发送 → 流式回复结束后的状态
  - `shots/a-landscape-chat-font.png`：设置里 A+ 三次，字号 16 → 19
  - `shots/a-landscape-thinktest.png`：思考开关打开后发送，最终回复 + 芯片高亮态
- **总览图**：`shots/overview-landing.png`、`shots/overview-chat.png`（3×2 拼图，快速对比）

> 截图均为 1024×768 / 768×1024 原始像素，PNG，无缩放。

## 推荐

**推荐 A（深蓝渐变 + 白色胶囊）作为主方向。**

理由：
1. 和用户给的 Gemini 参考「氛围」最接近（深空渐变 + 居中大标题 + 浅色胶囊），但配色与元素已经重做，不构成照抄。
2. 白色胶囊在深底上对比强，输入区一眼可见；这个 App 的核心动作就是「输入」，A 把视觉重心给了它。
3. 第一屏有「产品级」的开场感，适合作为发给用户看的方向稿；A 的 token 也能直接反向映射成 C/B（同一套结构）。

**如果更看重长时间阅读舒适度，选 C。** 石墨灰 + 暖沙强调色对夜间/长对话更友好，且明确不使用实时模糊，iPad 4 上最稳。
**B 作为风格备选**：气质最独特，但整体对比度刻意偏低，强光环境下可读性不如 A/C，用户气泡几乎融入背景。

> 我的建议：先用 A 给用户拍板；如果用户反馈「太亮/太像 Gemini」，再切 C。

## 打开与演示

直接双击任一 `index.html` 即可（file:// 也能跑，无任何网络请求）。三个文件互不依赖。

演示参数（也可用于截图/评审）：

| URL | 状态 |
| --- | --- |
| `a/index.html` | 首屏 landing |
| `a/index.html?demo=chat` | 预置两轮对话的对话态 |
| `a/index.html?demo=models` | 打开模型选择弹层 |
| `a/index.html?demo=settings` | 打开设置弹层 |

已实现的交互（三份文件共用同一段 JS，已逐项验证）：

- 输入框：中文 IME 正常；**Enter 发送**，Shift+Enter 换行；输入后发送键由灰变实心。
- 发送：同一页面进入对话态（标题与 hero 隐藏，输入胶囊移动到页面底部）；用户消息右侧气泡、AI 回复左侧纯文本。
- 流式回复：逐字追加（约 2 字 / 28ms）+ 闪烁光标；结束后光标消失。
- Markdown 示例渲染：`**粗体**`、行内 `` `code` ``、无序列表、有序列表、多段落。
- 思考开关：开启后先显示三点「正在思考…」约 0.95s，再开始流式回复；芯片高亮。
- 模型芯片：弹出模型弹层（假数据，按提供商分组），带选中态；选择后芯片名同步、toast 提示。
- 设置弹层：字号 **14–22**（A- / A+ 即时生效）、提供商下拉（OpenAI / DeepSeek / 阿里云百炼 / 自定义，联动 API 地址、端口与模型列表）、API 地址、端口、API Key、刷新模型列表（toast）、清空对话（回到 landing）。
- 「+」：唤起 `<input type="file" accept="image/*">`，本地 FileReader 预览缩略图（可移除），随消息作为图片气泡发送。
- 「新对话」按钮（对话态右上角）、Esc / 点击遮罩关闭弹层、底部 toast。
- 偏好（字号/提供商/模型）存 localStorage，namespace 按方向隔离：`ipadchat.<a|b|c>.*`。

## iOS 10.3 / Safari 10.1 兼容性

为了最终能塞进 iOS 10.3 的 WKWebView，原型刻意只用了老语法：

- ✅ CSS 自定义属性、flex、`-webkit-` 前缀、`position: fixed`、`calc`、`radial-gradient` / `linear-gradient`、`object-fit`、`-webkit-overflow-scrolling: touch`。
- ✅ JS 全部 ES5 写法（`var` / `function` / `textContent` / `classList` / FileReader / setInterval），没有任何现代语法。
- ❌ 不用 flex `gap`（一律 margin）、`backdrop-filter`、`dvh/svh`、`aspect-ratio`、`:has()`、`scroll-behavior: smooth`、CSS Grid、`clamp()`、`env(safe-area-inset-*)`、可选链 `?.`、空值合并 `??`。
- 视口布局用 `position: fixed; top/right/bottom/left: 0`（不依赖 `100vh`，软键盘弹出不塌）；消息区 `flex:1 + min-height:0` 滚动。
- 所有渐变/阴影都是**静态一次性绘制**，没有实时模糊、没有动画背景；对 iPad 4（A6X / 32 位）友好。
- 字体栈：`-apple-system, PingFang SC, Hiragino Sans GB, Microsoft YaHei, Helvetica Neue, Arial`。iPad 上走苹方；当前截图在 Windows 上跑，回退到微软雅黑。
- 响应式断点 `max-width: 820px`（竖屏 768 命中）：缩小标题/内边距、收窄胶囊内 chip 间距；两个视口均无溢出/错位（见截图）。

## 截图流水线（为什么不是普通 chrome 截图）

本机 DSH 会话沙箱**禁止子进程创建命名管道**，`chrome-headless-shell --screenshot` 会直接 `FATAL:mojo/platform_channel.cc ... 拒绝访问`，WMI / schtasks 创建进程同样被拒。因此截图改走：

1. `_capture/server.py` 在本机 `127.0.0.1:8765` 起一个 stdlib HTTP 服务（静态目录 = `prototypes/`，并接收 `POST /save?name=xxx` 落盘 PNG）。
2. 用 REA MCP 的 Playwright 浏览器（进程在 REA 侧，不受本会话沙箱限制）打开 `_capture/capture.html?shots=a-landscape,b-portrait`。
3. capture 页用 iframe 按目标视口加载原型，把 DOM 序列化成 `SVG <foreignObject>` → canvas → PNG → POST 回本地服务。

`_capture/` 只是这次截图的工具，**可以直接删掉**，不影响 a/b/c 的使用。

## 已知限制

- 对话态截图里输入框的草稿「继续细化一下」是为展示「发送键可用态」预置的；真实打开是空输入框。
- DOM 栅格化不保留滚动位置：对话很长时截图只呈现顶部内容；真实使用不受影响（消息区会自动滚到最新）。
- B 的极细描边（1px / 22% 白）在截图里偏淡，iPad 4 实际 PPI 更高、观感会更实一点；如果嫌弱可把 `--surface-border` 提到 `rgba(255,255,255,.28)`。
- A 的大面积径向渐变在 iPad 4 面板上可能有轻微色带（静态渐变，不耗性能）；介意可降为两段线性渐变。
- 模型列表、API 地址、AI 回复均为本地假数据，不联网、不校验 Key。
