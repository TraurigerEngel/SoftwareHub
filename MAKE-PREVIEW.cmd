@echo off
rem Visual Preview 12 must launch with the GUI subsystem (no debug console).
call "%~dp0MAKE-VISUAL-PREVIEW.cmd"
exit /b %ERRORLEVEL%
