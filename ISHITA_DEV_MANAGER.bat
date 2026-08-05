@echo off
setlocal
cd /d "%~dp0"
title ISHITA PRINT MASTER - Development Manager
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\dev-manager.ps1"
if errorlevel 1 (
  echo.
  echo Development manager stopped with an error.
  pause
)
endlocal
