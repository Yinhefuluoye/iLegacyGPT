# ipad-chat-client

面向 **iPad 4（iPad3,4 / armv7 / iOS 10.3.4）** 的极简 AI 对话客户端。

- 无登录，打开即用；直接调用任意 **OpenAI 兼容 API**（可配置 provider / base URL / 端口 / Key）。
- 界面：白底浅色、大号问候语、胶囊输入框（+ 上传图片 / 模型切换 / 思考档位 / 发送），按已确认的 UI 稿实现。
- 原生外壳（Objective-C + WKWebView），UI 由 TypeScript 编译产物驱动；iOS 10.3 Safari 10.1 兼容。
- 不需要越狱插件（iPad 已装 AppSync，爱思助手直接装未签名 IPA）。

## 目录

```
ios/                     Objective-C 外壳（Theos 风格布局，实际用 clang 直编）
  ChatAI/                AppDelegate / WebViewController / Bridge / AIService / Store
  Resources/             Info.plist、图标、web/（构建时注入 TS 产物）
web/                     TypeScript 前端
  src/                   bridge / app / markdown / 样式（生产 UI）
  prototypes/            a/b/c/d 设计原型 + 截图
  _preview/              本地预览服务器 + 截图页
tools/build.py           本地编译检查（armv7 链接靠 Theos）
tools/build_local.sh     WSL 内一键构建
tools/gh_push.py         git 协议不通时用 GitHub API 推送
tools/package_ipa.py     打 IPA
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

## Web UI（TypeScript）

界面是离线 bundle，由 `web/src/` 编译后注入 `ios/Resources/web/index.html`（自包含单文件）。

```powershell
cd web
npm install      # 首次
npm run build    # 产出 web/dist，并自动写入 ios/Resources/web/index.html
```

- 源码：`web/src/`（`bridge.ts` / `app.ts` / `markdown.ts` / `styles.css` / `extra.css`），无框架，目标 ES2015（iOS 10 WebKit）。
- 设计规格：`docs/ui-spec.md`；原生桥协议：`docs/bridge-protocol.md`。
- 本地预览（桌面自动走 mock 桥）：`python web/_preview/preview_server.py 8766` → 打开 `http://127.0.0.1:8766/dist/index.html`。
- 截图：`http://127.0.0.1:8766/_preview/capture.html?shots=dist-landscape&act=send`（用 REA 浏览器打开）。

## 在 iPad 上安装

1. 用爱思助手连接 iPad（已越狱 + AppSync）。
2. 「应用」→ 安装 IPA → 选 `dist/ChatAI-*.ipa`。
3. 首次打开后到设置里填 API 地址 / Key，刷新模型。

## 说明

- App 不签名（AppSync 环境），构建不依赖 Mac。
- 目标设备为 32 位 armv7，最低系统 8.0（实际只针对 iOS 10.3.4 测试）。
