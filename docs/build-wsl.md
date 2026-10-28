# Building on Windows with WSL2

Produces a signed-free IPA locally in 10–20 seconds after a source change. Requires Windows 10 2004 or later, or Windows 11.

English | [简体中文](build-wsl.zh-CN.md)

## 1. Prerequisites

Windows Subsystem for Linux 2 with an Ubuntu distribution. Administrator PowerShell:

```powershell
wsl --install
```

If `--install` is unavailable:

```powershell
dism.exe /online /enable-feature /featurename:Microsoft-Windows-Subsystem-Linux /all /norestart
dism.exe /online /enable-feature /featurename:VirtualMachinePlatform /all /norestart
```

Restart the machine after installation. Ubuntu requests a Linux user name and password on first launch; use lower case for the user name.

## 2. Verify the installation

```powershell
wsl -l -v
```

`Ubuntu` must report `VERSION 2`. If it reports 1:

```powershell
wsl --set-version Ubuntu 2
wsl --set-default-version 2
```

## 3. Install the toolchain

Run once inside Ubuntu:

```bash
sudo apt update && sudo apt install -y bash curl sudo git unzip python3 make perl
bash -c "$(curl -fsSL https://raw.githubusercontent.com/theos/theos/master/bin/install-theos)"
```

Theos is installed in `~/theos`, together with the Linux iOS toolchain and SDK.

## 4. Build

```bash
cd /mnt/d/Developer/Dsh-Work/projects/ipad-chat-client
NAME=iLegacyGPT VERSION=x.y.z bash tools/build_local.sh
```

Output: `dist/iLegacyGPT-<version>.ipa`, containing armv7 and arm64 slices.

The UI bundle is generated from `web/src` by `web/build.mjs`; run that first if TypeScript or CSS changed.

## 5. Troubleshooting

| Message | Action |
| --- | --- |
| `0x80370102`, virtualisation unavailable | enable Intel VT-x or AMD-V in firmware, and enable the Virtual Machine Platform Windows feature |
| `WSL 2 requires an update to its kernel component` | install `wsl_update_x64.msi`, then run `wsl --set-default-version 2` |
| Ubuntu download fails during `wsl --install` | install Ubuntu 22.04 from the Microsoft Store, or run `wsl --install -d Ubuntu` |
| `iPhoneOS10.3.sdk not found` | `$HOME/theos/bin/install-sdk 10.3` |
| `Theos not found` | `export THEOS=$HOME/theos`, or repeat step 3 |
| build is slow under `/mnt/d` | copy the repository into the Linux filesystem before building |
| removed resource still appears in the IPA | delete the staging directory: `rm -rf ios/.theos`, then rebuild |

## 6. Notes

- The build requires no root privileges; Theos is installed in the user home directory.
- After the first build, the `.theos` cache makes subsequent builds take a few seconds.
- The IPA is unsigned and is installed with a signing tool or AppSync Unified.