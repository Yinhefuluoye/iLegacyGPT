# Bridge protocol v1

The native host (`WKWebView`, `NSURLSession`, SSE parsing) and the Web UI communicate over this protocol.
Both sides must be updated together when it changes.

## 1. Channels

| Direction | Mechanism |
| --- | --- |
| Web to native | `window.webkit.messageHandlers.chat.postMessage(object)` |
| Native to Web | `window.__onNative(object)` |

Messages are JSON-serialisable objects. Messages from Web to native carry `op`; messages from native to Web carry `type`.

## 2. Web to native

| `op` | Payload | Response |
| --- | --- | --- |
| `config.get` | none | `{type:"config", config:{...}}` |
| `config.set` | `config:{...}` | `{type:"config", config:{...}}` after persisting |
| `models.fetch` | `config:{base,port,key}` | `GET {base}/models` then `{type:"models", models:[{id,...}], raw}` or `{type:"error", ...}` |
| `chat.start` | `requestId, config:{base,port,key}, model, messages:[{role,content}], image?:{mime,dataBase64}, thinking:{enabled,level,params}, search:{mode,...}` | stream of `delta` / `reasoning` / `searching` / `sources` / `done` / `error` |
| `chat.stop` | `requestId` | `{type:"aborted", requestId}` |
| `image.pick` | `source:"library"\|"camera"` | `{type:"image", image:{mime,dataBase64,width,height}}` or `{type:"cancel"}` |
| `store.load` | none | `{type:"store", data:{...}}` |
| `store.save` | `data:{...}` | `{type:"ok"}` |
| `log.write` | `text` | none |

## 3. Native to Web

| `type` | Fields | Notes |
| --- | --- | --- |
| `ready` | `build` | sent once after the WebView finishes loading |
| `config` | `config` | result of `config.get` / `config.set` |
| `models` | `models[], raw` | model inventory |
| `delta` | `requestId, text` | text increment, flushed in batches of 30–50 ms |
| `reasoning` | `requestId, text` | reasoning increment, optional |
| `searching` | `requestId` | the model called the search tool, retrieval in progress |
| `sources` | `requestId, items:[{index,title,url,snippet}]` | retrieved documents for this turn |
| `done` | `requestId, usage?` | stream finished |
| `error` | `requestId?, message, code?` | network, HTTP or parse failure |
| `aborted` | `requestId` | stream cancelled |
| `image` | `image` | result of `image.pick` |
| `store` | `data` | persisted sessions |
| `log` | `level, text` | diagnostic echo |

## 4. Configuration object

```json
{
  "provider": "DeepSeek",
  "baseUrl": "https://api.deepseek.com/v1",
  "port": 443,
  "apiKey": "sk-...",
  "model": "deepseek-chat",
  "models": ["deepseek-chat", "deepseek-reasoner"],
  "thinking": { "enabled": true, "level": 3, "params": { "reasoning_effort": "high" } },
  "search": { "mode": "auto", "url": "https://api.exa.ai/search", "key": "", "header": "x-api-key", "prefix": "", "body": "{\"query\":\"{{query}}\",\"numResults\":{{num}}}", "num": 5 },
  "fontSize": 17
}
```

## 5. Thinking parameters

The Web side computes the request parameters for the selected level and sends them as `params`.
The native side adds `params` to the request body unchanged when `enabled` is true. Boolean and numeric values are forwarded as JSON types.

| `level` | `params` |
| --- | --- |
| 0 (off) | `{}` for generic endpoints; `{"enable_thinking": false}` for Qwen-family endpoints, where thinking is enabled by default |
| 1 | `{"reasoning_effort": "low"}` |
| 2 | `{"reasoning_effort": "medium"}` |
| 3 | `{"reasoning_effort": "high"}` |

The legacy form `{param, onValue, offValue}` is still accepted by the native side.

## 6. Web search

`search.mode` is executed by the native side.

| `mode` | Behaviour |
| --- | --- |
| `off` | no `tools` field is sent |
| `auto` | the request carries `tools:[web_search]` and `tool_choice:"auto"`; when the model returns `tool_calls`, the native side emits `searching`, performs the retrieval, then issues one follow-up request with the results |
| `force` | retrieval happens before the first request |

6.1 The tool protocol is used for the first request only. The follow-up request carries neither `assistant{tool_calls}` nor `tool` messages, and does not echo `reasoning_content`; this keeps reasoning models from rejecting the request.

6.2 One tool call may contain several queries. Up to two are executed in order and their results are merged.

6.3 HTTP 400 or 422 on the tool request falls back to a query planner.

6.4 When retrieval returns nothing, a note is injected stating that no documents were retrieved.

## 7. Constraints

7.1 One `chat.start` corresponds to one `requestId`. A new request requires the previous one to have finished or been stopped.

7.2 `delta` carries complete UTF-8 text; incremental decoding and line buffering happen on the native side.

7.3 Images are transferred as base64 data URLs. Images above 4 MB are compressed before transfer.

7.4 The native side sends `ready` in `didFinishNavigation`; the Web side sends no message before receiving it.