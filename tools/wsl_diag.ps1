$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$proj = 'D:\Developer\Dsh-Work\projects\ipad-chat-client'
$log = Join-Path $proj '.toolchain\wsl\wsl-diag.txt'
$lines = New-Object System.Collections.Generic.List[string]

function RunWsl([string[]]$argList) {
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = "$env:SystemRoot\System32\wsl.exe"
    $psi.Arguments = ($argList -join ' ')
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.UseShellExecute = $false
    $psi.StandardOutputEncoding = [System.Text.Encoding]::Unicode
    $psi.StandardErrorEncoding = [System.Text.Encoding]::Unicode
    $p = [System.Diagnostics.Process]::Start($psi)
    $out = $p.StandardOutput.ReadToEnd()
    $err = $p.StandardError.ReadToEnd()
    $p.WaitForExit()
    return @{ Out = $out; Err = $err; Code = $p.ExitCode }
}

$r1 = RunWsl @('--status')
$lines.Add('=== wsl --status (exit ' + $r1.Code + ') ===')
$lines.Add($r1.Out.Trim())
$lines.Add($r1.Err.Trim())

$r2 = RunWsl @('--list', '--verbose')
$lines.Add('=== wsl -l -v (exit ' + $r2.Code + ') ===')
$lines.Add($r2.Out.Trim())
$lines.Add($r2.Err.Trim())

$tar = Join-Path $proj '.toolchain\wsl\ubuntu-jammy-rootfs.tar.gz'
$target = Join-Path $proj '.wsl\Ubuntu'
if (Test-Path $target) { Remove-Item -Recurse -Force $target }
$r3 = RunWsl @('--import', 'Ubuntu', $target, $tar, '--version', '1')
$lines.Add('=== wsl --import (exit ' + $r3.Code + ') ===')
$lines.Add($r3.Out.Trim())
$lines.Add($r3.Err.Trim())

$lines.Add('tar exists: ' + (Test-Path $tar) + ' size: ' + (Get-Item $tar -ErrorAction SilentlyContinue).Length)
[System.IO.File]::WriteAllLines($log, $lines, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "wrote $log"