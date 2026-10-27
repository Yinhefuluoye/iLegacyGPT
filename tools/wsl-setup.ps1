# One-time setup: import Ubuntu into WSL (WSL1) and install Theos + build deps.
#
# Run from a NORMAL PowerShell window (not needed to be admin):
#   cd D:\Developer\Dsh-Work\projects\ipad-chat-client
#   powershell -ExecutionPolicy Bypass -File tools\wsl-setup.ps1

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot          # repo root
$tar = Join-Path $root '.toolchain\wsl\ubuntu-jammy-rootfs.tar.gz'
$target = Join-Path $root '.wsl\Ubuntu'

if (-not (Test-Path $tar)) {
    throw "rootfs not found: $tar"
}

# Windows path -> WSL path (D:\a\b -> /mnt/d/a/b)
function To-WslPath([string]$p) {
    $full = [System.IO.Path]::GetFullPath($p)
    $drive = $full.Substring(0, 1).ToLowerInvariant()
    $rest = $full.Substring(2) -replace '\\', '/'
    return "/mnt/$drive$rest"
}

Write-Host "==> checking WSL…"
& wsl.exe --status
if ($LASTEXITCODE -ne 0) {
    throw "wsl.exe unavailable. Run this in your own PowerShell window (not inside a restricted sandbox)."
}

if (-not (Test-Path $target)) {
    Write-Host "==> importing Ubuntu (WSL1) into $target …"
    & wsl.exe --import Ubuntu $target $tar --version 1
    if ($LASTEXITCODE -ne 0) { throw "wsl --import failed" }
} else {
    Write-Host "==> Ubuntu already imported"
}

$wslRoot = To-WslPath $root

Write-Host "==> bootstrapping Ubuntu (user, apt deps, mirrors)…"
& wsl.exe -d Ubuntu -u root -- bash "$wslRoot/tools/wsl_bootstrap.sh"

Write-Host "==> installing Theos…"
& wsl.exe -d Ubuntu -u yinhe -- bash "$wslRoot/tools/wsl_install_theos.sh"

Write-Host "==> building Hello IPA…"
& wsl.exe -d Ubuntu -u yinhe -- bash "$wslRoot/tools/build_local.sh"

Write-Host ""
Write-Host "done. IPA should be in: $root\dist"
Get-ChildItem (Join-Path $root 'dist') -ErrorAction SilentlyContinue | Select-Object Name, Length