[![README: English](https://img.shields.io/badge/README-English-bf8a4b?style=flat-square)](README.md)
[![README: 简体中文](https://img.shields.io/badge/README-%E7%AE%80%E4%BD%93%E4%B8%AD%E6%96%87-8a8f88?style=flat-square)](README.zh-CN.md)

<div align="center">

<img src="docs/assets/logo.png" width="128" alt="iLegacyGPT">

# iLegacyGPT

**A large-language-model client for old iOS devices.** Tested on iPad 4 (iPad3,4 / A6X / armv7 / iOS 10.3.4).

No account, no login, no telemetry — it talks to any OpenAI-compatible endpoint, and your API key never leaves your own device.

`v1.2.0` · Objective-C + TypeScript · MIT

</div>

---

## What is this

A 10-year-old iPad can't run modern apps and can't be updated. This project exists for one reason: **let old devices talk to modern LLMs**.

It is a native shell with a web UI:

- **Objective-C shell** (Theos layout, built with clang) hosting a `WKWebView`;
- the UI is **TypeScript** compiled into one self-contained bundle, written against the iOS 10 WebKit feature set;
- networking, configuration and session storage all live in the native layer — the web layer only draws.

It **ships no API and no keys**. You point it at your own OpenAI-compatible service.

## Screenshots

| Home | Chat with reasoning | Session drawer | Settings |
| --- | --- | --- | --- |
| <img src="docs/screenshots/01-home.png" width="220"> | <img src="docs/screenshots/02-thinking.png" width="260"> | <img src="docs/screenshots/03-sessions.png" width="260"> | <img src="docs/screenshots/04-settings.png" width="260"> |

| Web search with sources | Markdown tables and task lists | Image input |
| --- | --- | --- |
| <img src="docs/screenshots/06-search.png" width="260"> | <img src="docs/screenshots/07-table.png" width="420"> | <img src="docs/screenshots/05-image.png" width="260"> |

## Features

- **Any OpenAI-compatible API** — configurable provider, base URL, port and key; model list fetched live;
- **Reasoning levels** — off / low / medium / high, sent as `reasoning_effort`, `enable_thinking` or custom key-value pairs;
- **Web search** — off / auto / force; in auto mode the model itself decides through real function calling (`web_search`), results come back as numbered sources with clickable links;
- **Streaming output and visible reasoning** — reasoning appears first, expandable, then the answer streams in;
- **Markdown** — tables (alignment, wide-table scrolling), task lists, nested lists, code blocks, links;
- **Session archive** — left drawer grouped by Today / Last 7 days / Earlier, swipe to rename or delete;
- **Image input** — pick from the photo library; history keeps a 320 px thumbnail;
- **Local-only data** — sessions, settings and keys live in the app sandbox; deleting the app deletes everything;
- **armv7 + arm64** — one IPA for 32-bit devices (iPad 4, iPhone 5/5c) and for 64-bit devices on iOS 9/10 (iPhone 5s … 7);
- **Tuned for old WebKit** — the UI is compiled to **ES5** (iOS 9 has no `let`/arrow functions), and avoids `gap`, `inset`, `backdrop-filter` and friends; the build script rejects forbidden CSS and re-checks ES5.

## Compatibility

| | Status |
| --- | --- |
| iPad 4 (iPad3,4, armv7) on iOS 10.3.4 | ✅ tested |
| armv7 on iOS 9.3.5 / 9.3.6 (iPad 2/3, iPhone 4S, iPod touch 5) | ⚠️ supported, not tested |
| arm64 on iOS 9 / 10 (iPhone 5s … 7) | ⚠️ supported, not tested |
| iOS below 9.3 | ❌ no CSS custom properties |
| iOS 11 and later | ❔ untested |
| Jailbreak tweaks | not required (AppSync + unsigned IPA is enough) |

## Install

> Requires **AppSync Unified** or a self-signing tool — the IPA is unsigned.

1. Download `iLegacyGPT-1.2.0.ipa` from [Releases](../../releases);
2. Install with i4Tools / ipatool / any self-signing tool;
3. Open the app → settings (top right) → fill in **provider, base URL, port, API key**, then refresh the model list.

> The build is unsigned and contains no Apple assets. Use it on personal devices you own.

## Quick start

1. Settings → pick a provider → enter `Base URL` (e.g. `https://api.openai.com`) and port;
2. Enter your API key (stored on device only);
3. Go back, type a question, send;
4. To let it "think": tap 思考 in the composer and pick low/medium/high (whether it takes effect depends on your gateway).

## Privacy

- no accounts, no telemetry, no analytics;
- API key and sessions are written to the app sandbox only — there is no server of ours to send them to;
- images are uploaded only when you press send, and only to the endpoint you configured;
- deleting the app wipes everything.

See [PRIVACY.md](PRIVACY.md) and [SECURITY.md](SECURITY.md). 中文版：[隐私说明](PRIVACY.zh-CN.md) · [安全说明](SECURITY.zh-CN.md)

## Build

**Toolchain**: WSL (Ubuntu 22.04) + Theos + iPhoneOS 10.3 SDK + Swift toolchain — see [docs/build-wsl.md](docs/build-wsl.md) (Chinese).

```bash
VERSION=1.2.0 bash tools/build_local.sh
python tools/package_ipa.py --app ios/.theos/obj/iphone/8.0/ChatAI.app --version 1.2.0 --name iLegacyGPT
```

Output: `dist/iLegacyGPT-1.2.0.ipa` (~100 KB).

There is **no CI**: releases are built locally in about five seconds.

## Layout

```
ios/                     Objective-C shell
  ChatAI/                AppDelegate / WebViewController / bridge / AIService / Store
  Resources/             Info.plist, icons, web/
web/                     TypeScript frontend (src / prototypes / _preview)
tools/                   build, package, icon and release scripts
docs/                    bridge protocol, UI spec, build notes, screenshots
```

- Bridge protocol (web ↔ native): [docs/bridge-protocol.md](docs/bridge-protocol.md)
- UI specification: [docs/ui-spec.md](docs/ui-spec.md)

## Known limitations

- **armv7 only** — 64-bit devices can't install this build;
- images in history are kept as **320 px thumbnails** only (the original isn't persisted, so you can't ask follow-ups about an old image after reopening the session);
- reasoning levels depend on the gateway: some ignore `reasoning_effort`, in which case configure custom parameters;
- iOS 10 WebKit is old: no flex `gap`, `inset`, `backdrop-filter`, optional chaining — check the forbidden list in `web/build.mjs` before touching the UI;
- unsigned IPA: jailbreak / AppSync or re-signing required.

## Disclaimer

- This project is **not affiliated with, endorsed by, or sponsored by OpenAI**. `GPT` here refers to general-purpose large language models;
- it ships **no API key and no proxy service**; you must bring your own compliant endpoint;
- the unsigned IPA is intended for personal devices that are jailbroken or can be re-signed — follow your local laws and platform terms;
- the software is provided "as is", without warranty of any kind.

## License

[MIT](LICENSE)