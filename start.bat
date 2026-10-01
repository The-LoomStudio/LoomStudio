@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 22.18 or newer, then start again.
  pause
  exit /b 1
)
node scripts\start.mjs
set "LOOM_EXIT_CODE=%ERRORLEVEL%"
if not "%LOOM_EXIT_CODE%"=="0" pause
exit /b %LOOM_EXIT_CODE%
