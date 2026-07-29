@echo off
setlocal
cd /d "%~dp0"

where node.exe >nul 2>&1
if errorlevel 1 (
  echo Node.js is required to generate SMART PRINT developer licenses.
  pause
  exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\license-key-generator.ps1"
if errorlevel 1 (
  echo.
  echo License generation failed.
)

echo.
pause
endlocal
