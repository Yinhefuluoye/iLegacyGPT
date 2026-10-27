# 安全说明

## 报告问题

- 一般 Bug / 功能建议：走 [Issues](../../issues)；
- 安全问题（例如能导致 Key 泄露、任意代码执行、绕过沙盒等）：请**不要**开公开 issue，改用 GitHub 的私有漏洞报告（Security → Report a vulnerability），或先私信作者。

## 请不要在公开场合贴这些内容

- 你的 **API Key**、`Authorization` 头、完整的 Base URL（带 token 的那种）；
- 包含个人信息的会话截图（聊天内容、图片）；
- 你的设备序列号、Apple ID 相关信息。

发 issue 时如果需要贴日志，请先把 Key、域名、消息内容涂掉。

## 已知的安全边界

- API Key 以明文形式保存在 App 沙盒（`Library/Application Support/ChatAI/`），**未额外加密**。这是本机私用工具的取舍：越狱设备上任何有 root 权限的程序都能读到它；
- 安装包**未签名**，安装依赖 AppSync 或自签名，请只从本仓库 Releases 下载，不要使用来路不明的「二次打包版」；
- 本项目不内置任何代理、不转发请求，你的流量直接发往你配置的接口。