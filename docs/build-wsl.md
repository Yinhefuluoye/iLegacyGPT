# 在 Windows 上用 WSL2 本地构建 IPA

> 目标：改完代码 10–20 秒出 `dist/ChatAI-*.ipa`，不依赖 GitHub Actions。
> 适用：Windows 10 2004+ / Windows 11（本机为 Windows 10 19045，支持）。

## 1. 一次性安装（管理员 PowerShell）

```powershell
wsl --install
```

- 会自动启用「适用于 Linux 的 Windows 子系统」和「虚拟机平台」，并安装 Ubuntu。
- 装完**重启电脑**；重启后 Ubuntu 窗口会自动打开，要求创建 Linux 用户名和密码
  （用户名用小写，密码输入时看不到字符，记住它）。
- 如果提示不认识 `--install`，用下面两条命令代替，然后重启：

```powershell
dism.exe /online /enable-feature /featurename:Microsoft-Windows-Subsystem-Linux /all /norestart
dism.exe /online /enable-feature /featurename:VirtualMachinePlatform /all /norestart
```

## 2. 验证

```powershell
wsl -l -v
```

应显示 `Ubuntu` 且 `VERSION` 为 `2`。如果 VERSION 是 1：

```powershell
wsl --set-version Ubuntu 2
wsl --set-default-version 2
```

## 3. 安装依赖 + Theos（Ubuntu 里执行一次）

```bash
sudo apt update && sudo apt install -y bash curl sudo git unzip python3 make perl
bash -c "$(curl -fsSL https://raw.githubusercontent.com/theos/theos/master/bin/install-theos)"
```

Theos 会装到 `~/theos`，并下载 Linux 版 iOS 工具链和 SDK（约几百 MB）。

## 4. 构建

```bash
cd /mnt/d/Developer/Dsh-Work/projects/ipad-chat-client
bash tools/build_local.sh
# 产物：dist/ChatAI-0.1.local.ipa
```

## 常见问题

| 现象 | 处理 |
| --- | --- |
| `0x80370102` / 提示虚拟化未启用 | 进 BIOS 打开 Intel VT-x / AMD-V，或「启用或关闭 Windows 功能」里勾选「虚拟机平台」 |
| `WSL 2 requires an update to its kernel component` | 安装 [wsl_update_x64.msi](https://wslstorekit.blob.core.windows.net/wslupdates/wsl_update_x64.msi)，再 `wsl --set-default-version 2` |
| `wsl --install` 下载 Ubuntu 失败 | Microsoft Store 手动装 Ubuntu 22.04，或 `wsl --install -d Ubuntu` |
| 构建报 `iPhoneOS10.3.sdk not found` | `$HOME/theos/bin/install-sdk 10.3` |
| 构建报 `Theos not found` | `export THEOS=$HOME/theos` 或重跑第 3 步安装脚本 |
| `/mnt/d` 下构建慢 | 可选：`cp -r /mnt/d/.../ipad-chat-client ~/build && cd ~/build`（产物再拷回 dist/） |

## 备注

- 构建不需要 root；Theos 装在自己的家目录。
- 首次构建后 `.theos/` 缓存生效，后续编译通常在 10 秒内。
- IPA 不签名，装到 iPad 仍然走爱思助手（AppSync 已装）。