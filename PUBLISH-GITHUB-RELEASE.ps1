#Requires -Version 5.1
[CmdletBinding()]
param([switch]$ConfirmedSmokeTest)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSCommandPath
$version = '0.7.5'
$tag = "v$version"
$repo = 'TraurigerEngel/SoftwareHub'
# Audited HEAD of main on 2026-11-16. Refuse if it has changed since preparation.
$expectedMainSha = 'b2b002a146366a298bbca90ddf1966eac0a8ac4a'
$assets = Join-Path $root ('Artifacts\Software_Hub_v'+$version+'_Stable')
$prefix = 'Software_Hub_v'+$version+'_Stable'
$portableZip = Join-Path $assets ($prefix+'_Portable.zip')
$sourceZip = Join-Path $assets ($prefix+'_Source.zip')
$checksums = Join-Path $assets 'SHA256SUMS.txt'
$tempDir = $null
function Assert([bool] $ok,[string] $message) { if (-not $ok) { throw $message } }
function Run([string] $cmd, [string[]] $arguments, [string] $message) {
    Write-Host ">>> $message" -ForegroundColor Cyan
    & $cmd @arguments
    if ($LASTEXITCODE -ne 0) { throw "$message failed (exit $LASTEXITCODE)." }
}
try {
    Assert $ConfirmedSmokeTest.IsPresent 'First smoke-test the Windows EXE; then pass -ConfirmedSmokeTest.'
    Assert ($env:OS -eq 'Windows_NT') 'Run on Windows.'
    Assert ((Test-Path -LiteralPath (Join-Path $root '.SOFTWARE_HUB_STABLE_SOURCE') -PathType Leaf)) 'This is not the approved Stable source.'
    $pkg = Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw | ConvertFrom-Json
    Assert ($pkg.version -eq $version) 'Source version does not match release version.'
    foreach ($file in @($portableZip,$sourceZip,$checksums)) {
        Assert (Test-Path -LiteralPath $file -PathType Leaf) "Required file missing: $file. Run BUILD-ON-WINDOWS.ps1 first."
    }
    foreach ($cmd in @('git.exe','gh.exe')) {
        Assert ([bool](Get-Command $cmd -ErrorAction SilentlyContinue)) "Missing $cmd. Install Git for Windows and GitHub CLI."
    }
    # SHA256SUMS belongs to this exact build. Do not accept stale/mismatched assets.
    $hashMap = @{}
    foreach ($line in (Get-Content -LiteralPath $checksums)) {
        Assert ($line -match '^([a-fA-F0-9]{64})\s{2,}(.+)$') "Invalid SHA256SUMS line: $line"
        Assert (-not $hashMap.ContainsKey($Matches[2])) "Duplicate checksum entry: $($Matches[2])"
        $hashMap[$Matches[2]] = $Matches[1].ToLowerInvariant()
    }
    Assert ($hashMap.Count -eq 2) 'Expected exactly two checksum entries.'
    foreach ($zip in @($portableZip,$sourceZip)) {
        $name = Split-Path -Leaf $zip
        Assert ($hashMap.ContainsKey($name)) "Missing checksum for $name."
        Assert (((Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash).ToLowerInvariant() -eq $hashMap[$name]) "SHA256 mismatch: $name"
    }

    Add-Type -AssemblyName 'System.IO.Compression'
    Add-Type -AssemblyName 'System.IO.Compression.FileSystem'
    # Source must be a safe whitelist, with no secrets or generated files.
    $zipReader = [System.IO.Compression.ZipFile]::OpenRead($sourceZip)
    try {
        foreach ($entry in $zipReader.Entries) {
            $name = $entry.FullName.Replace('\','/')
            Assert (-not ($name.StartsWith('/') -or $name -match '(^|/)\.\.(/|$)' -or $name -match '^[a-zA-Z]:')) "Unsafe source ZIP entry: $name"
            Assert (-not ($name -match '(?i)(^|/)(?:\.git|portable-data|node_modules|target|Release|Artifacts|BuildLogs)(?:/|$)' -or $name -match '(?i)(^|/)\.env(?:\.|/|$)' -or $name -match '(?i)\.(?:pem|key|pfx|p12|db|sqlite3|log|bak|tmp)$')) "Private/generated source ZIP entry: $name"
        }
    } finally { $zipReader.Dispose() }

    Run 'gh.exe' @('auth','status') 'Verify GitHub login'
    $visibility = (& gh.exe repo view $repo --json visibility --jq '.visibility')
    Assert ($LASTEXITCODE -eq 0 -and $visibility.Trim() -eq 'PUBLIC') 'Repository visibility or access mismatch; expected public SoftwareHub.'
    # A missing release is expected before first publication: use a successful list query.
    $existingReleasesJson = & gh.exe release list --repo $repo --limit 100 --json tagName
    Assert ($LASTEXITCODE -eq 0) 'Unable to check GitHub releases; refusing to publish.'
    $existingReleases = @($existingReleasesJson | ConvertFrom-Json)
    $releaseMatches = @($existingReleases | Where-Object { $_.tagName -eq $tag })
    Assert ($releaseMatches.Count -eq 0) "GitHub release $tag already exists. It will not be overwritten."
    $gitName = (& git.exe config --global user.name)
    $gitEmail = (& git.exe config --global user.email)
    Assert ($LASTEXITCODE -eq 0 -and $gitName -and $gitEmail) 'Configure git user.name and user.email before publishing.'

    $tempDir = Join-Path $env:TEMP ('softwarehub-publish-'+[guid]::NewGuid().ToString('N'))
    New-Item -Path $tempDir -ItemType Directory -Force | Out-Null
    $clone = Join-Path $tempDir 'repo'
    $extract = Join-Path $tempDir 'source'
    $remoteUrl = 'https://github.com/'+$repo+'.git'
    Run 'gh.exe' @('auth','setup-git') 'Configure GitHub HTTPS credentials for git'
    Run 'git.exe' @('clone','--quiet','--depth','1','--branch','main',$remoteUrl,$clone) 'Clone protected publishing workspace'
    $remoteHead = (& git.exe -C $clone rev-parse HEAD).Trim()
    Assert ($LASTEXITCODE -eq 0 -and $remoteHead -eq $expectedMainSha) "main changed since the verified v0.7.4 baseline: $remoteHead. Stop and review before publishing."
    $remoteTag = & git.exe -C $clone ls-remote --tags origin ('refs/tags/'+$tag)
    Assert ($LASTEXITCODE -eq 0 -and -not $remoteTag) "Tag $tag already exists; refusing to overwrite."

    New-Item -Path $extract -ItemType Directory -Force | Out-Null
    [System.IO.Compression.ZipFile]::ExtractToDirectory($sourceZip,$extract)
    $parents = @(Get-ChildItem -LiteralPath $extract -Force)
    Assert ($parents.Count -eq 1 -and $parents[0].PSIsContainer) 'Source ZIP should have exactly one root directory.'
    $src = $parents[0].FullName
    $allowedDirs = @('assets','data','migration-reference','scripts','src-tauri','tests','web')
    $allowedRootFiles = @('.SOFTWARE_HUB_STABLE_SOURCE','.gitignore','.gitattributes','README.md','README-STABLE.txt','LICENSE',
        'CATALOG_UPDATE_RU.md','GITHUB_PRIVACY_RU.md','RELEASE-PROVENANCE.json','RELEASE_CHECKLIST_RU.md',
        'RELEASE_NOTES_RU.md','BUILD_AND_RELEASE_RU.md','BUILD-ON-WINDOWS.ps1','PUBLISH-GITHUB-RELEASE.ps1',
        'MAKE-FINAL-ARCHIVES.ps1','MAKE-RELEASE.cmd','MAKE-PREVIEW.cmd','MAKE-VISUAL-PREVIEW.cmd',
        'package.json','package-lock.json')
    $allow = @($allowedDirs) + @($allowedRootFiles)
    foreach ($entry in (Get-ChildItem -LiteralPath $src -Force)) {
        Assert ($allow -contains $entry.Name) "Unexpected top-level source ZIP item: $($entry.Name)"
        Assert (-not ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint)) "Symlink in source ZIP: $($entry.Name)"
        $destination = Join-Path $clone $entry.Name
        if (Test-Path -LiteralPath $destination) { Remove-Item -LiteralPath $destination -Recurse -Force }
        Copy-Item -LiteralPath $entry.FullName -Destination $destination -Force -Recurse
    }
    foreach ($item in $allow) {
        # Add only approved paths. Never git add -A blindly from the user's local working directory.
        & git.exe -C $clone add -- $item
        if ($LASTEXITCODE -ne 0) { throw "Unable to stage $item" }
    }
    Run 'git.exe' @('-C',$clone,'diff','--cached','--check') 'Verify staged source diff'
    $changed = @(& git.exe -C $clone diff --cached --name-only)
    Assert ($LASTEXITCODE -eq 0 -and $changed.Count -gt 0) 'No source changes detected; refusing to create an empty release.'
    Write-Host ('Staged '+$changed.Count+' changed paths. Source ZIP has passed privacy and SHA256 checks.')

    # Re-check main immediately before writing. No force-push, no tag overwrites.
    Run 'git.exe' @('-C',$clone,'fetch','origin','main','--quiet') 'Re-check remote main'
    $nowHead = (& git.exe -C $clone rev-parse 'origin/main').Trim()
    Assert ($LASTEXITCODE -eq 0 -and $nowHead -eq $expectedMainSha) 'Remote main changed while staging; aborting.'
    Run 'git.exe' @('-C',$clone,'commit','-m','release: Software Hub v0.7.5 catalog expansion (141 cards)') 'Commit v0.7.5 curated source files'
    Run 'git.exe' @('-C',$clone,'push','origin','HEAD:refs/heads/main') 'Push main (fast-forward only)'
    Run 'git.exe' @('-C',$clone,'tag','-a',$tag,'-m','Software Hub v0.7.5 Stable Catalog Expansion') 'Create annotated release tag'
    Run 'git.exe' @('-C',$clone,'push','origin',('refs/tags/'+$tag)) 'Publish v0.7.5 tag'
    $notes = Join-Path $clone 'RELEASE_NOTES_RU.md'
    Run 'gh.exe' @('release','create',$tag,$portableZip,$sourceZip,$checksums,'--repo',$repo,'--verify-tag',
        '--title','Software Hub v0.7.5 Stable — Catalog Expansion','--notes-file',$notes) 'Create GitHub Release and upload verified assets'
    Run 'gh.exe' @('release','view',$tag,'--repo',$repo,'--json','tagName,assets') 'Verify published GitHub Release'
    Write-Host "`nGITHUB RELEASE PUBLISHED: https://github.com/$repo/releases/tag/$tag" -ForegroundColor Green
} catch {
    Write-Host "`nPUBLISH STOPPED: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host 'If the source/tag push succeeded but creating the Release failed, do NOT force-push or delete the tag. Ask for recovery steps.'
    exit 1
} finally {
    if ($tempDir -and (Test-Path -LiteralPath $tempDir)) {
        Remove-Item -LiteralPath $tempDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}
