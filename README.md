# ipad-chat-client

面向 **iPad 4（iPad3,4 / armv7 / iOS 10.3.4）** 的极简 AI 对话客户端。

- 无登录，打开即用；直接调用任意 **OpenAI 兼容 API**（可配置 provider / base URL / 端口 / Key）。
- 界面参考 Gemini：深色背景、大号问候语、胶囊输入框（+ 上传图片 / 模型切换 / 思考开关 / 发送）。
- 原生外壳（Objective-C + WKWebView），UI 由 TypeScript 编译产物驱动；iOS 10.3 Safari 10.1 兼容。
- 不需要越狱插件（iPad 已装 AppSync，爱思助手直接装未签名 IPA）。

## 目录

```
ios/                     Objective-C 外壳（Theos 风格布局，实际用 clang 直编）
  ChatAI/                AppDelegate / WebViewController / Bridge / AIService / Store
  Resources/             Info.plist、图标、web/（构建时注入 TS 产物）
web/                     TypeScript 前端（src/ 源码、prototypes/ 设计原型）
tools/build.py           编译 + 组装 IPA（Windows / Linux 通用）
.github/workflows/       GitHub Actions 出包
dist/                    构建产物（不入库）
.toolchain/              本地工具链（LLVM / iPhoneOS10.3.sdk，不入库）
```

## 构建

**方式 A：GitHub Actions（默认）** —— push 到 `main` 自动出包，产物在 Actions 的 artifact 里。

**方式 B：本地 WSL2（Windows，适合快速迭代）**

```bash
cd /mnt/d/Developer/Dsh-Work/projects/ipad-chat-client
bash tools/build_local.sh        # 产物 dist/ChatAI-*.ipa
```

首次安装步骤见 [docs/build-wsl.md](docs/build-wsl.md)。

**方式 C：Windows 原生只做编译检查**（不能链接 armv7，链接必须靠 Theos）

```powershell
python tools/build.py --sdk .toolchain\theos-sdks\iPhoneOS10.3.sdk --clang .toolchain\llvm\bin\clang.exe --compile-only
```

## 在 iPad 上安装

1. 用爱思助手连接 iPad（已越狱 + AppSync）。
2. 「应用」→ 安装 IPA → 选 `dist/ChatAI-*.ipa`。
3. 首次打开后到设置里填 API 地址 / Key，刷新模型。

## 说明

- App 不签名（AppSync 环境），构建不依赖 Mac。
- 目标设备为 32 位 armv7，最低系统 8.0（实际只针对 iOS 10.3.4 测试）。
