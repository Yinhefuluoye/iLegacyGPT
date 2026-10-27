# ChatAI 原生外壳 ↔ Web UI 桥协议 v1

> 原生侧：Objective-C（WKWebView + NSURLSession + SSE 解析）。
> Web 侧：TypeScript 编译产物（离线 bundle）。两端共享本协议。

## 通道

- Web → 原生：`window.webkit.messageHandlers.chat.postMessage(<object>)`
- 原生 → Web：`window.__onNative(<object>)`

所有消息都是 JSON 可序列化对象，带 `op`（Web→原生）或 `type`（原生→Web）。

## Web → 原生

| op | 字段 | 原生行为 |
| --- | --- | --- |
| `config.get` | — | 返回 `{type:"config", config:{...}}` |
| `config.set` | `config:{...}` | 持久化并返回 `{type:"config", config:{...}}` |
| `models.fetch` | `config:{base,port,key}` | 请求 `GET {base}/models` → `{type:"models", models:[{id,...}], raw}` 或 `{type:"error", ...}` |
| `chat.start` | `requestId, config:{base,port,key}, model, messages:[{role,content}], image?:{mime,dataBase64}, thinking:{enabled,level,params}, search:{mode,...}` | 流式返回 `delta`/`done`/`error`；`search.mode=auto` 时可能先返回 `searching` |
| `chat.stop` | `requestId` | 取消该次请求，返回 `{type:"aborted", requestId}` |
| `image.pick` | `source:"library"\|"camera"` | 返回 `{type:"image", image:{mime,dataBase64,width,height}}` 或 `{type:"cancel"}` |
| `store.load` | — | 返回 `{type:"store", data:{...}}` |
| `store.save` | `data:{...}` | 持久化对话，返回 `{type:"ok"}` |
| `log.write` | `text` | 写入诊断日志 |

## 原生 → Web

| type | 字段 | 说明 |
| --- | --- | --- |
| `ready` | `build` | WebView 加载完成后由原生主动推送一次 |
| `config` | `config` | 设置读写结果 |
| `models` | `models[], raw` | 模型列表 |
| `delta` | `requestId, text` | 文本增量（30–50ms 批量 flush） |
| `reasoning` | `requestId, text` | （可选）思考内容增量 |
| `searching` | `requestId` | 模型调用了检索工具，正在搜（用于把「正在思考…」换成「正在联网搜索…」） |
| `sources` | `requestId, items:[{index,title,url,snippet}]` | 本轮检索到的网页，Web 渲染成可点开的来源列表 |
| `done` | `requestId, usage?` | 流结束 |
| `error` | `requestId?, message, code?` | 错误（网络/HTTP/解析） |
| `aborted` | `requestId` | 已停止 |
| `image` | `image` | 选图结果 |
| `store` | `data` | 会话恢复 |
| `log` | `level, text` | 诊断回显 |

## 配置结构（config）

```json
{
  "provider": "DeepSeek",
  "baseUrl": "https://api.deepseek.com/v1",
  "port": 443,
  "apiKey": "sk-...",
  "model": "deepseek-chat",
  "models": ["deepseek-chat", "deepseek-reasoner"],
  "thinking": { "enabled": false, "level": 0, "param": "reasoning_effort", "onValue": "high", "offValue": "" },
  "fontSize": 17
}
```

`thinking.level` 是 UI 的档位（0 关闭 / 1 低 / 2 中 / 3 高）。**Web 侧计算好实际参数**再发：

```jsonc
// 高（auto 模式，非 qwen 系端点）
{ "enabled": true, "level": 3, "params": { "reasoning_effort": "high" } }
// 关闭（qwen 系端点/模型：必须显式关，否则网关默认开）
{ "enabled": true, "level": 0, "params": { "enable_thinking": false } }
// 关闭（其他端点：不发参数）
{ "enabled": false, "level": 0, "params": {} }
```

原生按 `thinking.enabled` 决定是否把 `params` 原样加进请求体；**布尔与数字按 `NSNumber` 直通**
（历史 bug：早期只接受字符串，导致 `enable_thinking`、`thinking_budget` 被静默丢弃）。
兼容旧格式 `{param, onValue, offValue}`。

## 联网搜索（v1.1）

`config.search.mode` 有三态，全部由原生执行：

| mode | 行为 |
| --- | --- |
| `off` | 不带 `tools`，纯对话 |
| `auto` | 请求带 `tools:[web_search]` + `tool_choice:"auto"`；模型返回 `tool_calls` 后，原生发 `searching` → 检索 → 用检索结果作为系统消息**再发一轮**（该轮 `search.noTools=true`，不会再循环） |
| `force` | 先检索，再带结果发首轮 |

- 工具协议只用于**第一轮**：第二轮不带 `assistant{tool_calls}` / `tool` 消息，也不回传
  `reasoning_content`，避开思考模型的 400；
- 一次可返回多条查询，原生顺序检索最多 2 条并合并资料；
- 网关拒绝 `tools`（HTTP 400/422）时自动降级到搜索规划器；
- 检索失败时注入一段「没取到资料」的系统说明，避免模型编造链接。

## 约束

- 单次 `chat.start` 只对应一个 `requestId`；新请求前 Web 必须保证上一个已结束或已 stop。
- `delta` 只传**完整 UTF-8 文本**（原生做增量解码与行缓冲）。
- 图片以 base64 data URL 传回 Web；超过 4MB 的图片原生先压缩。
- 原生在 `didFinishNavigation` 后推送 `ready`，Web 收到后才发第一条消息。
