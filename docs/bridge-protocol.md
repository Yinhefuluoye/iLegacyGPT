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
| `chat.start` | `requestId, config:{base,port,key}, model, messages:[{role,content}], image?:{mime,dataBase64}, thinking:{enabled,level,param,onValue,offValue}` | 流式返回 `delta`/`done`/`error` |
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

`thinking.level` 是 UI 的档位（0 关闭 / 1 低 / 2 中 / 3 高）。`onValue` 由 UI 按档位给出：

| level | 名称 | `enabled` | `onValue`（默认 `reasoning_effort`） |
| --- | --- | --- | --- |
| 0 | 关闭 | false | — |
| 1 | 低 | true | `low` |
| 2 | 中 | true | `medium` |
| 3 | 高 | true | `high` |

原生按 `thinking.enabled` 决定是否把 `{param: onValue}` 加进请求体；换 provider 时只需在设置里改
`param`/值映射（例如 Qwen 系可用 `enable_thinking` + `thinking_budget`）。

## 约束

- 单次 `chat.start` 只对应一个 `requestId`；新请求前 Web 必须保证上一个已结束或已 stop。
- `delta` 只传**完整 UTF-8 文本**（原生做增量解码与行缓冲）。
- 图片以 base64 data URL 传回 Web；超过 4MB 的图片原生先压缩。
- 原生在 `didFinishNavigation` 后推送 `ready`，Web 收到后才发第一条消息。
