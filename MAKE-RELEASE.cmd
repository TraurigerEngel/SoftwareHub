@echo off
setlocal EnableExtensions
cd /d "%~dp0"
if exist ".SOFTWARE_HUB_RC_ONLY" (
  echo ERROR: RC-only source. Use the dedicated RC build workflow.
  exit /b 1
)
if exist ".VISUAL_PREVIEW_ONLY" (
  echo ERROR: Visual Preview 12 must not be published as Stable.
  echo Build with MAKE-VISUAL-PREVIEW.cmd instead.
  exit /b 1
)
echo [1/5] Checking source parity...
call npm run verify
if errorlevel 1 goto :failed
echo [2/5] Running Rust behavioral tests...
cargo test --manifest-path .\src-tauri\Cargo.toml --locked --lib
if errorlevel 1 goto :failed
echo [3/5] Building optimized Tauri release without installer...
call npm run build:release
if errorlevel 1 goto :failed
echo [4/5] Publishing isolated portable stable release...
call npm run publish:release
if errorlevel 1 goto :failed
echo [5/5] Independently verifying published Stable release...
call npm run verify:release
if errorlevel 1 goto :failed
echo.
echo SOFTWARE HUB STABLE BUILT AND VERIFIED.
echo Test a COPY of the printed Release folder before considering Stable final.
exit /b 0
:failed
echo.
echo RELEASE BUILD FAILED. Read the first Rust/npm error above and send the log.
exit /b 1
