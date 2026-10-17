@echo off
setlocal EnableExtensions
cd /d "%~dp0"
if not exist ".VISUAL_PREVIEW_ONLY" (
  echo This command is intended only for the isolated Visual Preview source.
  exit /b 1
)
echo [1/5] Installing pinned dependencies...
call npm ci --no-audit --no-fund
if errorlevel 1 goto :failed
echo [2/5] Verifying catalog, splash, motion and desktop UI...
call npm run verify
if errorlevel 1 goto :failed
echo [3/5] Running Rust tests...
cargo test --manifest-path .\src-tauri\Cargo.toml --locked --lib
if errorlevel 1 goto :failed
echo [4/5] Building Windows GUI executable (release profile, no console)...
call npm run build:release
if errorlevel 1 goto :failed
echo [5/5] Copying into an isolated Preview folder...
if not exist "Visual-Preview-12" mkdir "Visual-Preview-12"
if not exist "Visual-Preview-12" goto :failed
copy /y "src-tauri\target\release\software-hub-tauri.exe" "Visual-Preview-12\SoftwareHub.exe" >nul
if errorlevel 1 goto :failed
if not exist "Visual-Preview-12\portable-data" mkdir "Visual-Preview-12\portable-data"
if not exist "Visual-Preview-12\portable-data" goto :failed
> "Visual-Preview-12\PREVIEW-NOT-STABLE.txt" echo Software Hub Visual Preview 12 - test build based on v0.7.1 Stable, not approved for release.
echo.
echo VISUAL PREVIEW 12 BUILD OK
 echo Location: "%CD%\Visual-Preview-12\SoftwareHub.exe"
echo Do not replace the v0.7.1 Stable executable until preview has been verified.
exit /b 0
:failed
echo.
echo VISUAL PREVIEW BUILD FAILED. Read the first error above.
exit /b 1
