[![README: English](https://img.shields.io/badge/README-English-8a8f88?style=flat-square)](README.md)
[![README: 简体中文](https://img.shields.io/badge/README-%E7%AE%80%E4%BD%93%E4%B8%AD%E6%96%87-bf8a4b?style=flat-square)](README.zh-CN.md)

<div align="center">

<img src="docs/assets/logo.png" width="128" alt="iLegacyGPT">

# iLegacyGPT

**给老 iOS 设备用的大模型客户端。** iPad 4（iPad3,4 / A6X / armv7 / iOS 10.3.4）实测可用。

无登录、无账号、无遥测；直接连接任意 OpenAI 兼容接口，API Key 只存在你自己的设备里。

`v1.2.0` · Objective-C + TypeScript · MIT

</div>

---

## 这是什么

一台 10 年前的 iPad，跑不动新版 App，也不支持新系统。这个项目的目标只有一个：**让老设备也能用大模型**。

做法是「原生外壳 + Web UI」：

- **Objective-C 外壳**（Theos 布局、clang 直编）+ `WKWebView` 渲染界面；
- 界面用 **TypeScript** 写成单文件产物，塞进 `WKWebView`，避开 iOS 10 缺失的所有新 API；
- 网络、配置、会话存储全部在原生层完成，Web 只负责画界面。

它**不提供**任何 API 或 Key，你需要在设置里填自己的 OpenAI 兼容服务。

## 截图

| 首屏 | 对话与思考过程 | 会话抽屉 | 设置 |
| --- | --- | --- | --- |
| <img src="docs/screenshots/01-home.png" width="220"> | <img src="docs/screenshots/02-thinking.png" width="260"> | <img src="docs/screenshots/03-sessions.png" width="260"> | <img src="docs/screenshots/04-settings.png" width="260"> |

## 特性

- **任意 OpenAI 兼容接口**：自定义 provider / Base URL / 端口 / API Key，模型列表自动拉取；
- **思考档位**：关闭 / 低 / 中 / 高，按网关支持的参数下发（`reasoning_effort`、`enable_thinking` 或自定义键值对）；
- **联网搜索**：关闭 / 自动 / 强制三态；「自动」走**真 function calling**（`web_search` 工具），由模型自己决定搜不搜，结果以带编号的来源列表呈现、可点开链接；
- **流式输出 + 思考过程**：先显示思考要点，可点开看完整思考，再逐字吐正文；
- **Markdown**：表格（支持对齐、宽表横向滑动）、任务列表、嵌套列表、代码块、链接；
- **会话归档**：左侧抽屉按「今天 / 近 7 天 / 更早」分组，左滑重命名、删除；
- **图片上传**：从相册选图发送，历史里保留 320px 缩略图；
- **数据只在本机**：会话、配置、Key 全部存在 App 沙盒，卸载即消失；
- **armv7 + arm64 双架构**：同一个包能装 32 位机（iPad 4、iPhone 5/5c）与跑 iOS 9/10 的 64 位机（iPhone 5s ~ 7）；
- **为老 WebKit 定制**：界面 JS 编译到 **ES5**（iOS 9 没有 `let`/箭头函数），不用 `gap`、`inset`、`backdrop-filter`、`classList.toggle(cls, force)` 等新特性，构建脚本会拦截违规 CSS 并复查 ES5。

## 支持范围

| 项目 | 状态 |
| --- | --- |
| iPad 4（iPad3,4，armv7）+ iOS 10.3.4 | ✅ 实测 |
| armv7 + iOS 9.3.5 / 9.3.6（iPad 2/3、iPhone 4S、iPod touch 5） | ⚠️ 已支持，未实测 |
| arm64 + iOS 9 / 10（iPhone 5s ~ 7） | ⚠️ 已支持，未实测 |
| iOS 9.3 以下 | ❌ 缺 CSS 自定义属性 |
| iOS 11 及以上 | ❔ 未验证 |
| 越狱插件 | 不需要（AppSync + 未签名 IPA 即可） |

## 安装

> 需要设备已安装 **AppSync Unified**（或使用自签名工具重签），否则无法安装未签名 IPA。

1. 到 [Releases](../../releases) 下载 `iLegacyGPT-1.2.0.ipa`；
2. 用爱思助手 / ipatool / 自签名工具安装；
3. 打开 App → 右上角设置 → 填写 **provider、Base URL、端口、API Key**，拉一次模型列表。

> 安装包未签名、不含任何 Apple 资源，仅用于已越狱或可自签名的个人设备。

## 快速开始

1. 设置 → 选择 provider（OpenAI / 自定义）→ 填 `Base URL`（例如 `https://api.openai.com`）和端口；
2. 填 API Key（只存本机）；
3. 回到首页，输入问题 → 发送；
4. 想让它「思考」：点输入框里的「思考」，选低/中/高（具体是否生效取决于你的网关是否支持对应参数）。

## 隐私

- **无账号、无遥测、无统计**；
- API Key 与会话只写入 App 沙盒内的 `store.json` 与配置，不上传任何我们的服务器（我们也没有服务器）；
- 图片仅在你点击发送时，随请求发往你配置的接口；
- 卸载 App 即清除全部数据。

详见 [PRIVACY.md](PRIVACY.md)。

## 构建

**环境**：WSL（Ubuntu 22.04）+ Theos + iPhoneOS10.3 SDK + Swift toolchain（详见 [docs/build-wsl.md](docs/build-wsl.md)）。

```bash
VERSION=1.2.0 bash tools/build_local.sh
python tools/package_ipa.py --app ios/.theos/obj/iphone/8.0/ChatAI.app --version 1.2.0 --name iLegacyGPT
```

产物：`dist/iLegacyGPT-1.2.0.ipa`（约 100 KB）。

本项目**不使用 CI**：出包全靠本地脚本，WSL 里约 5 秒完成。

## 目录结构

```
ios/                     Objective-C 外壳
  ChatAI/                AppDelegate / WebViewController / 桥接 / AIService / Store
  Resources/             Info.plist、图标、web/
web/                     TypeScript 前端（src / prototypes / _preview）
tools/                   构建、打包、图标、发布脚本
docs/                    bridge-protocol.md、ui-spec.md、build-wsl.md、截图
```

- 桥接协议（Web ↔ 原生）：[docs/bridge-protocol.md](docs/bridge-protocol.md)
- UI 规范：[docs/ui-spec.md](docs/ui-spec.md)

## 已知限制

- 只编了 **armv7**，64 位设备装不上；
- 历史消息里的图片只保留 **320px 缩略图**，原图不落盘（重新打开会话无法继续「带着那张图」提问）；
- 思考档位是否生效取决于你的网关：有的网关忽略 `reasoning_effort`，需要在设置里改用自定义参数；
- iOS 10 的 WebKit 很老：不支持 flex `gap`、`inset`、`backdrop-filter`、可选链等，改 UI 请先看 `web/build.mjs` 里的禁用列表；
- 未签名 IPA，安装门槛是越狱 / AppSync 或自签名。

## 免责声明

- 本项目**与 OpenAI 无任何关联**，也未获得任何形式的授权或认可；名称中的 `GPT` 仅指代通用大语言模型；
- 项目**不提供、也不包含**任何 API Key 或代理服务，使用者需自行准备合规的接口；
- 未签名 IPA 仅面向已越狱或可自签名的**个人设备**，请遵守你所在地区的法律法规与平台条款；
- 软件按「原样」提供，作者不对使用后果、数据丢失或账号风险负责。

## 许可

[MIT](LICENSE)