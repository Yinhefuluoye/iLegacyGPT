# iLegacyGPT

<p align="center"><img src="docs/assets/logo.png" width="128" alt="iLegacyGPT"></p>


A chat client for legacy iOS devices that connects to any OpenAI-compatible API.
There is no account, no telemetry and no backend service; the API key is stored on the device.

`Objective-C + TypeScript` · `MIT` · [![release](https://img.shields.io/github/v/release/Yinhefuluoye/iLegacyGPT?style=flat-square)](../../releases)

[简体中文](README.zh-CN.md)

## Compatibility

| Item | Value |
| --- | --- |
| Tested device | iPad 4 (iPad3,4, A6X, armv7) on iOS 10.3.4 |
| Minimum iOS | 9.3 |
| Architectures | armv7, arm64 |
| Installation | unsigned IPA, requires AppSync Unified or re-signing |

| Platform | Status |
| --- | --- |
| iPad 4 (armv7), iOS 10.3.4 | Tested |
| armv7, iOS 9.3.5 / 9.3.6: iPad 2, iPad 3, iPhone 4S, iPod touch 5 | Untested |
| arm64, iOS 9 / 10: iPhone 5s through iPhone 7 | Untested |
| iOS 11 and later | Untested |
| iOS below 9.3 | Not supported |

## Install

1. Install **AppSync Unified** on the device, or prepare a signing tool.
2. Download the IPA from [Releases](../../releases).
3. Install with i4Tools, ipatool or any signing tool.
4. Open the application, then open Settings and enter the provider, base URL, port and API key.
5. Refresh the model list and select a model.

## Configure

- **Endpoint**: any OpenAI-compatible API. Base URL, port and key are stored in the application sandbox.
- **Reasoning level**: off, low, medium or high. The value is sent as `reasoning_effort`, or as `enable_thinking` with `thinking_budget` on Qwen-family endpoints.
- **Web search**: off, auto or force.
  - `auto` advertises a `web_search` tool and lets the model decide whether to call it.
  - `force` searches before the first request.
  - Results are attached to the answer as numbered sources with links.
- **Font size**: adjustable in Settings; stored on the device.

## Features

- Streaming output with an expandable reasoning block.
- Real function calling for web search; endpoints that reject `tools` fall back to a query planner.
- Markdown rendering: tables with column alignment, task lists, nested lists, strikethrough, links, code blocks.
- Session archive grouped by today, last 7 days and earlier, with rename and delete.
- Image input from the photo library; history keeps a 320 px thumbnail.
- Current time and time zone are included with every request.
- Bundled as a single self-contained HTML file; the UI is ES5 and avoids WebKit features unavailable on iOS 9/10.

## Screenshots

| Home | Chat with reasoning | Session drawer | Settings |
| --- | --- | --- | --- |
| <img src="docs/screenshots/01-home.png" width="220"> | <img src="docs/screenshots/02-thinking.png" width="260"> | <img src="docs/screenshots/03-sessions.png" width="260"> | <img src="docs/screenshots/04-settings.png" width="260"> |

| Web search with sources | Markdown tables and task lists | Image input |
| --- | --- | --- |
| <img src="docs/screenshots/06-search.png" width="260"> | <img src="docs/screenshots/07-table.png" width="420"> | <img src="docs/screenshots/05-image.png" width="260"> |

## Build from source

Toolchain: WSL (Ubuntu 22.04), Theos, iPhoneOS 10.3 SDK. See [docs/build-wsl.md](docs/build-wsl.md).

```bash
cd web && node build.mjs   # TypeScript -> ES5 bundle -> ios/Resources/web/index.html
npx tsc --noEmit           # type check
NAME=iLegacyGPT VERSION=x.y.z bash tools/build_local.sh
```

The build produces `dist/iLegacyGPT-<version>.ipa` containing both armv7 and arm64 slices.

## Project layout

| Path | Contents |
| --- | --- |
| `ios/ChatAI/` | application sources: window, WebView bridge, streaming client, storage |
| `ios/Resources/web/index.html` | generated UI bundle, CSS and JS inlined |
| `web/src/` | TypeScript and CSS sources |
| `web/build.mjs` | bundler: `tsc` to ES5, then esbuild, then inlining |
| `web/_preview/` | local screenshot harness |
| `tools/` | build, packaging and release scripts |
| `docs/` | protocol reference, build notes, release notes, images |

## Privacy and security

No data leaves the device except the requests sent to the endpoint configured by the user.
See [PRIVACY.md](PRIVACY.md) and [SECURITY.md](SECURITY.md).

## License

MIT. Not affiliated with OpenAI; `GPT` refers to general-purpose large language models.
This project ships no API key and no proxy service, and is provided as is.