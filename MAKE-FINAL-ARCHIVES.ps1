# Software Hub v0.7.3 Stable packaging (PowerShell 5.1-compatible).
if (Test-Path -LiteralPath (Join-Path $PSScriptRoot '.VISUAL_PREVIEW_ONLY')) {
    throw 'Visual Preview 12 cannot be packaged as a Stable release.'
}
# Must be run from the isolated Stable source, after verified release publication.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Add-Type -AssemblyName System.IO.Compression.FileSystem

function FileHash([string]$File) {
    $stream = [System.IO.File]::OpenRead($File)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try { return [System.BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() }
    finally { $sha.Dispose(); $stream.Dispose() }
}
function Assert([bool]$Condition, [string]$Why) { if (-not $Condition) { throw $Why } }
function CopySourceTree([string]$From,[string]$To) {
    New-Item -ItemType Directory -Path $To -Force | Out-Null
    $excluded = @('node_modules','target','.git','Release','Artifacts','Stable-Work','ReleaseCandidate-Work','PATCH-BACKUPS','Visual-Preview-12','RC-Test-v0.7.2_RC1')
    foreach ($entry in (Get-ChildItem -LiteralPath $From -Force)) {
        if (($entry.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw ('Refusing source symlink: ' + $entry.FullName)
        }
        if ($excluded -contains $entry.Name) { continue }
        if ((Split-Path -Path $From -Leaf) -eq 'web' -and $entry.Name -eq 'fonts') { continue }
        $destination = Join-Path $To $entry.Name
        if ($entry.PSIsContainer) { CopySourceTree $entry.FullName $destination }
        else { Copy-Item -LiteralPath $entry.FullName -Destination $destination }
    }
}
function VerifyRelease([string]$Verifier,[string]$Folder) {
    & node $Verifier $Folder
    if ($LASTEXITCODE -ne 0) { throw ('Stable release verification failed: ' + $Folder) }
}

$root = $PSScriptRoot
Assert (Test-Path -LiteralPath (Join-Path $root '.SOFTWARE_HUB_STABLE_SOURCE') -PathType Leaf) 'Not an approved isolated Stable source.'
Assert (-not (Test-Path -LiteralPath (Join-Path $root '.VISUAL_PREVIEW_ONLY'))) 'Refusing to package Preview as Stable.'
Assert (-not (Test-Path -LiteralPath (Join-Path $root '.SOFTWARE_HUB_RC_ONLY'))) 'Refusing to package RC as Stable.'
$version = '0.7.3'
$pkg = Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw | ConvertFrom-Json
Assert ($pkg.version -eq $version) 'Stable package version mismatch.'
$releaseRoot = Join-Path $root 'Release'
Assert (Test-Path -LiteralPath $releaseRoot -PathType Container) 'Release directory missing.'
$releases = @(Get-ChildItem -LiteralPath $releaseRoot -Directory |
    Where-Object { $_.Name -match '^Software_Hub_Tauri_v0\.7\.3_Stable_\d{8}-\d{6}$' } |
    Sort-Object LastWriteTime -Descending)
Assert ($releases.Count -eq 1) 'Expected exactly one v0.7.3 Stable release folder (no ambiguous selection).'
$release = $releases[0]
$verifier = Join-Path $root 'scripts\verify-release-candidate.cjs'
VerifyRelease $verifier $release.FullName
$manifest = Get-Content -LiteralPath (Join-Path $release.FullName 'RELEASE-MANIFEST.json') -Raw | ConvertFrom-Json
Assert ($manifest.version -eq $version -and $manifest.releaseChannel -eq 'stable') 'Manifest is not v0.7.3 Stable.'
Assert ((FileHash (Join-Path $release.FullName 'SoftwareHub.exe')) -eq $manifest.executable.sha256) 'Stable EXE hash mismatch.'

# Include every build input and every visual CSS/icon source, not only the pre-Preview frontend files.
$top = @('README.md','README-STABLE.txt','RELEASE-PROVENANCE.json','.SOFTWARE_HUB_STABLE_SOURCE','.gitignore',
    'package.json','package-lock.json','MAKE-RELEASE.cmd','MAKE-PREVIEW.cmd','MAKE-VISUAL-PREVIEW.cmd','MAKE-FINAL-ARCHIVES.ps1')
$dirs = @('assets','data','migration-reference','scripts','src-tauri','tests','web')
foreach ($name in $top) { Assert (Test-Path -LiteralPath (Join-Path $root $name) -PathType Leaf) ('Missing source file: ' + $name) }
foreach ($name in $dirs) { Assert (Test-Path -LiteralPath (Join-Path $root $name) -PathType Container) ('Missing source folder: ' + $name) }

$artifactParent = Join-Path $root 'Artifacts'
$artifactName = 'Software_Hub_v0.7.3_Stable'
$artifact = Join-Path $artifactParent $artifactName
Assert (-not (Test-Path -LiteralPath $artifact)) 'Stable output already exists; will not overwrite.'
$tmp = Join-Path $env:TEMP ('shub-stable-pack-'+[guid]::NewGuid().ToString('N'))
$portableFolderName = $release.Name
$sourceFolderName = $artifactName + '_Source'
$portableFolder = Join-Path $tmp $portableFolderName
$sourceFolder = Join-Path $tmp $sourceFolderName
$portableZip = Join-Path $tmp ($artifactName + '_Portable.zip')
$sourceZip = Join-Path $tmp ($artifactName + '_Source.zip')
$verifyPortable = Join-Path $tmp 'verify-portable'
$verifySource = Join-Path $tmp 'verify-source'
$stagingResult = Join-Path $tmp 'result'
try {
    New-Item -ItemType Directory -Path $portableFolder,$sourceFolder,$verifyPortable,$verifySource,$stagingResult -Force | Out-Null
    foreach ($item in (Get-ChildItem -LiteralPath $release.FullName -Force)) {
        if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Symlink in release folder.' }
        Copy-Item -LiteralPath $item.FullName -Destination $portableFolder -Recurse
    }
    foreach ($name in $top) { Copy-Item -LiteralPath (Join-Path $root $name) -Destination (Join-Path $sourceFolder $name) }
    foreach ($name in $dirs) { CopySourceTree (Join-Path $root $name) (Join-Path $sourceFolder $name) }
    [System.IO.Compression.ZipFile]::CreateFromDirectory($portableFolder,$portableZip,[System.IO.Compression.CompressionLevel]::Optimal,$true)
    [System.IO.Compression.ZipFile]::CreateFromDirectory($sourceFolder,$sourceZip,[System.IO.Compression.CompressionLevel]::Optimal,$true)
    [System.IO.Compression.ZipFile]::ExtractToDirectory($portableZip,$verifyPortable)
    [System.IO.Compression.ZipFile]::ExtractToDirectory($sourceZip,$verifySource)
    $unpackedPortable = Join-Path $verifyPortable $portableFolderName
    $unpackedSource = Join-Path $verifySource $sourceFolderName
    Assert (Test-Path -LiteralPath $unpackedPortable -PathType Container) 'Portable ZIP root missing.'
    Assert (Test-Path -LiteralPath $unpackedSource -PathType Container) 'Source ZIP root missing.'
    Assert (@(Get-ChildItem -LiteralPath $verifyPortable -Force).Count -eq 1) 'Unexpected Portable ZIP roots.'
    Assert (@(Get-ChildItem -LiteralPath $verifySource -Force).Count -eq 1) 'Unexpected Source ZIP roots.'
    VerifyRelease $verifier $unpackedPortable
    $srcPackage = Get-Content -LiteralPath (Join-Path $unpackedSource 'package.json') -Raw | ConvertFrom-Json
    Assert ($srcPackage.version -eq $version) 'Wrong version in Source ZIP.'
    foreach ($name in $top) { Assert (Test-Path -LiteralPath (Join-Path $unpackedSource $name) -PathType Leaf) ('Source ZIP missing '+$name) }
    foreach ($name in $dirs) { Assert (Test-Path -LiteralPath (Join-Path $unpackedSource $name) -PathType Container) ('Source ZIP missing folder '+$name) }
    foreach ($name in @('visual-preview-10.css','visual-preview-11.css','visual-preview-12.css','splash-stable-073.css','brand-icon.png','index.html','renderer.js','particles.js')) {
        Assert (Test-Path -LiteralPath (Join-Path $unpackedSource ('web\'+$name)) -PathType Leaf) ('Source ZIP missing UI asset '+$name)
    }
    foreach ($name in @('node_modules','src-tauri\target','web\fonts','Release','.VISUAL_PREVIEW_ONLY','.SOFTWARE_HUB_RC_ONLY')) {
        Assert (-not (Test-Path -LiteralPath (Join-Path $unpackedSource $name))) ('Unwanted generated or preview source item: '+$name)
    }
    foreach ($name in @('MAKE-FINAL-ARCHIVES.ps1','web\index.html','web\renderer.js','web\visual-preview-12.css','web\splash-stable-073.css','assets\icon.png','src-tauri\src\lib.rs')) {
        Assert ((FileHash (Join-Path $unpackedSource $name)) -eq (FileHash (Join-Path $root $name))) ('Source ZIP changed file: '+$name)
    }
    $finalPortable = Join-Path $stagingResult ($artifactName+'_Portable.zip')
    $finalSource = Join-Path $stagingResult ($artifactName+'_Source.zip')
    Copy-Item -LiteralPath $portableZip -Destination $finalPortable
    Copy-Item -LiteralPath $sourceZip -Destination $finalSource
    $portableSha=FileHash $finalPortable
    $sourceSha=FileHash $finalSource
    @(
        ('{0}  {1}' -f $portableSha,(Split-Path -Leaf $finalPortable)),
        ('{0}  {1}' -f $sourceSha,(Split-Path -Leaf $finalSource))
    ) | Set-Content -LiteralPath (Join-Path $stagingResult 'SHA256SUMS.txt') -Encoding ASCII
    New-Item -ItemType Directory -Path $artifactParent -Force | Out-Null
    Assert (-not (Test-Path -LiteralPath $artifact)) 'Stable artifact directory appeared during packaging; refusing overwrite.'
    Move-Item -LiteralPath $stagingResult -Destination $artifact
    Write-Host ''
    Write-Host 'SOFTWARE HUB v0.7.2 STABLE ARCHIVES VERIFIED' -ForegroundColor Green
    Write-Host ('Stable EXE SHA-256: '+$manifest.executable.sha256)
    Write-Host ('Portable ZIP: '+(Join-Path $artifact ($artifactName+'_Portable.zip')))
    Write-Host ('Portable ZIP SHA-256: '+$portableSha)
    Write-Host ('Source ZIP: '+(Join-Path $artifact ($artifactName+'_Source.zip')))
    Write-Host ('Source ZIP SHA-256: '+$sourceSha)
    Write-Host ('Checksums: '+(Join-Path $artifact 'SHA256SUMS.txt'))
} finally {
    if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Recurse -Force }
}
