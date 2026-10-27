# Rebuild the IPA inside WSL.
#
#   cd D:\Developer\Dsh-Work\projects\ipad-chat-client
#   powershell -ExecutionPolicy Bypass -File tools\build-wsl.ps1

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot

function To-WslPath([string]$p) {
    $full = [System.IO.Path]::GetFullPath($p)
    $drive = $full.Substring(0, 1).ToLowerInvariant()
    $rest = $full.Substring(2) -replace '\\', '/'
    return "/mnt/$drive$rest"
}

$wslRoot = To-WslPath $root
& wsl.exe -d Ubuntu -u yinhe -- bash "$wslRoot/tools/build_local.sh"
if ($LASTEXITCODE -ne 0) { throw "build failed" }

Write-Host ""
Get-ChildItem (Join-Path $root 'dist') -ErrorAction SilentlyContinue | Select-Object Name, Length