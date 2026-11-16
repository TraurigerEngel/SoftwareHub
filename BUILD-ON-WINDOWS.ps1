#Requires -Version 5.1
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSCommandPath
$version = '0.7.5'
$logs = Join-Path $root 'BuildLogs'
New-Item -Path $logs -ItemType Directory -Force | Out-Null
$log = Join-Path $logs ('build-'+(Get-Date -Format 'yyyyMMdd-HHmmss')+'.txt')
$transcriptStarted = $false
$ok = $false

function Assert([bool] $condition, [string] $message) {
    if (-not $condition) { throw $message }
}
function Run([string] $command, [string[]] $arguments, [string] $label) {
    Write-Host "`n>>> $label" -ForegroundColor Cyan
    & $command @arguments
    if ($LASTEXITCODE -ne 0) { throw "$label failed (exit code $LASTEXITCODE)." }
}
try {
    Start-Transcript -Path $log -Force | Out-Null
    $transcriptStarted = $true
    Push-Location -LiteralPath $root
    try {
        Assert ([Environment]::Is64BitOperatingSystem) 'This build is intended for Windows x64.'
        Assert ($env:OS -eq 'Windows_NT') 'Build this app on Windows 11 x64 (MSVC).'
        Assert ((Test-Path -LiteralPath (Join-Path $root '.SOFTWARE_HUB_STABLE_SOURCE') -PathType Leaf)) 'Missing Stable source marker.'
        foreach ($marker in @('.SOFTWARE_HUB_RC_ONLY','.VISUAL_PREVIEW_ONLY')) {
            Assert (-not (Test-Path -LiteralPath (Join-Path $root $marker))) "Refusing to build $marker as Stable."
        }
        $pkg = Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw | ConvertFrom-Json
        Assert ($pkg.version -eq $version) "Expected v$version, got $($pkg.version)"
        foreach ($name in @('node.exe','npm.cmd','cargo.exe','rustc.exe')) {
            Assert ([bool](Get-Command $name -ErrorAction SilentlyContinue)) "Missing $name. Install Node.js 22 or Rust MSVC as applicable, then reopen PowerShell."
        }
        $nodeVersion = (& node.exe --version).Trim()
        Assert ($LASTEXITCODE -eq 0 -and $nodeVersion -match '^v22\.') "Node.js 22.x required; found $nodeVersion."
        $hostTriple = & rustc.exe -vV
        Assert ($LASTEXITCODE -eq 0 -and [bool]($hostTriple -match 'host:\s*x86_64-pc-windows-msvc')) 'Rust x86_64-pc-windows-msvc toolchain required.'

        Write-Host "Building Software Hub v$version on Windows" -ForegroundColor Green
        Write-Host "Node: $nodeVersion"
        Write-Host 'Rust host: x86_64-pc-windows-msvc'
        Write-Host 'Previous portable folders and GitHub releases will NOT be changed.'

        Run 'npm.cmd' @('ci','--no-audit','--no-fund') 'Install lockfile-pinned npm dependencies'
        Run 'npm.cmd' @('run','verify') 'JavaScript tests and catalog validation'
        Run 'cargo.exe' @('test','--manifest-path','src-tauri/Cargo.toml','--locked','--lib') 'Rust tests (locked)'
        Run 'npm.cmd' @('run','build:release') 'Tauri Windows optimized build (no installer)'
        Run 'npm.cmd' @('run','publish:release') 'Prepare isolated portable EXE and manifest'
        Run 'npm.cmd' @('run','verify:release') 'Verify Windows x64 PE, manifest, hash and empty portable-data'
        Write-Host "`n>>> Create final source/portable ZIPs + SHA256SUMS" -ForegroundColor Cyan
        & (Join-Path $root 'MAKE-FINAL-ARCHIVES.ps1')
        $artifact = Join-Path $root 'Artifacts\Software_Hub_v0.7.5_Stable'
        Assert ((Test-Path -LiteralPath (Join-Path $artifact 'Software_Hub_v0.7.5_Stable_Portable.zip') -PathType Leaf)) 'Portable ZIP is missing.'
        Assert ((Test-Path -LiteralPath (Join-Path $artifact 'Software_Hub_v0.7.5_Stable_Source.zip') -PathType Leaf)) 'Source ZIP is missing.'
        Assert ((Test-Path -LiteralPath (Join-Path $artifact 'SHA256SUMS.txt') -PathType Leaf)) 'SHA256SUMS.txt is missing.'
        $ok = $true
        Write-Host "`nBUILD AND PACKAGE COMPLETED" -ForegroundColor Green
        Write-Host "Assets: $artifact"
        Write-Host 'Next: extract a COPY of Portable.zip and test SoftwareHub.exe on Windows 11.'
        Write-Host 'Only then publish: .\PUBLISH-GITHUB-RELEASE.ps1 -ConfirmedSmokeTest'
    } finally {
        Pop-Location
    }
} catch {
    Write-Host "`nBUILD FAILED: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host 'Keep the log file and share its final error lines for diagnosis.'
} finally {
    if ($transcriptStarted) { try { Stop-Transcript | Out-Null } catch {} }
    Write-Host "Log: $log"
}
if (-not $ok) { exit 1 }
