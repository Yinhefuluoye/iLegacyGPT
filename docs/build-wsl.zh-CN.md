# 在 Windows 上用 WSL2 构建

修改源码后可在本地于 10–20 秒内产出 IPA。要求 Windows 10 2004 及以上版本，或 Windows 11。

[English](build-wsl.md) | 简体中文

## 1. 前置条件

启用适用于 Linux 的 Windows 子系统 2，并安装 Ubuntu 发行版。管理员 PowerShell：

```powershell
wsl --install
```

若该命令不可用：

```powershell
dism.exe /online /enable-feature /featurename:Microsoft-Windows-Subsystem-Linux /all /norestart
dism.exe /online /enable-feature /featurename:VirtualMachinePlatform /all /norestart
```

安装后重启。Ubuntu 首次启动时要求创建 Linux 用户名与密码，用户名使用小写。

## 2. 验证安装

```powershell
wsl -l -v
```

`Ubuntu` 的 `VERSION` 必须为 `2`。若为 1：

```powershell
wsl --set-version Ubuntu 2
wsl --set-default-version 2
```

## 3. 安装工具链

在 Ubuntu 中执行一次：

```bash
sudo apt update && sudo apt install -y bash curl sudo git unzip python3 make perl
bash -c "$(curl -fsSL https://raw.githubusercontent.com/theos/theos/master/bin/install-theos)"
```

Theos 安装至 `~/theos`，同时包含 Linux 版 iOS 工具链与 SDK。

## 4. 构建

```bash
cd /mnt/d/Developer/Dsh-Work/projects/ipad-chat-client
NAME=iLegacyGPT VERSION=x.y.z bash tools/build_local.sh
```

产物：`dist/iLegacyGPT-<version>.ipa`，包含 armv7 与 arm64 两份切片。

界面产物由 `web/build.mjs` 从 `web/src` 生成；修改 TypeScript 或 CSS 后须先运行该脚本。

## 5. 故障处理

| 提示 | 处理 |
| --- | --- |
| `0x80370102`，虚拟化不可用 | 在固件中启用 Intel VT-x 或 AMD-V，并启用「虚拟机平台」Windows 功能 |
| `WSL 2 requires an update to its kernel component` | 安装 `wsl_update_x64.msi`，然后执行 `wsl --set-default-version 2` |
| `wsl --install` 下载 Ubuntu 失败 | 从 Microsoft Store 安装 Ubuntu 22.04，或执行 `wsl --install -d Ubuntu` |
| `iPhoneOS10.3.sdk not found` | `$HOME/theos/bin/install-sdk 10.3` |
| `Theos not found` | `export THEOS=$HOME/theos`，或重做第 3 步 |
| 在 `/mnt/d` 下构建缓慢 | 先将仓库复制到 Linux 文件系统中再构建 |
| 已删除的资源仍出现在 IPA 中 | 删除暂存目录后重新构建：`rm -rf ios/.theos` |

## 6. 说明

- 构建不需要 root 权限，Theos 安装于用户家目录。
- 首次构建后由 `.theos` 缓存加速，后续构建耗时数秒。
- IPA 未签名，需使用签名工具或 AppSync Unified 安装。