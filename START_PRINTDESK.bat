@echo off
setlocal
cd /d "%~dp0"
title PrintDesk Launcher
where node.exe >nul 2>&1
if errorlevel 1 (
  echo Node.js is not installed or not available in PATH.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Installing PrintDesk dependencies...
  call npm.cmd install
  if errorlevel 1 (
    echo Dependency installation failed.
    pause
    exit /b 1
  )
)

netstat -ano | findstr /R /C:":3000 .*LISTENING" >nul
if errorlevel 1 powershell.exe -NoProfile -WindowStyle Hidden -Command "Start-Process -FilePath 'cmd.exe' -ArgumentList '/d','/c','npm.cmd run dev:web -- --host 127.0.0.1 --port 3000' -WorkingDirectory '%CD%' -WindowStyle Hidden"

netstat -ano | findstr /R /C:":3001 .*LISTENING" >nul
if errorlevel 1 powershell.exe -NoProfile -WindowStyle Hidden -Command "Start-Process -FilePath 'cmd.exe' -ArgumentList '/d','/c','npm.cmd run dev:whatsapp' -WorkingDirectory '%CD%' -WindowStyle Hidden"

netstat -ano | findstr /R /C:":4040 .*LISTENING" >nul
if errorlevel 1 (
  if exist "C:\laragon\bin\ngrok\ngrok.exe" (
    powershell.exe -NoProfile -WindowStyle Hidden -Command "Start-Process -FilePath 'C:\laragon\bin\ngrok\ngrok.exe' -ArgumentList 'http','3001','--url','https://chatter-frighten-quotation.ngrok-free.dev' -WorkingDirectory '%CD%' -WindowStyle Hidden"
  ) else (
    echo WARNING: ngrok was not found at C:\laragon\bin\ngrok\ngrok.exe
  )
)

echo Starting PrintDesk...
timeout /t 6 /nobreak >nul
start "" "http://127.0.0.1:3000"
echo.
echo PrintDesk: http://127.0.0.1:3000
echo Ngrok dashboard: http://127.0.0.1:4040
echo Meta webhook: https://chatter-frighten-quotation.ngrok-free.dev/api/meta/webhook
echo You may close this launcher window.
timeout /t 3 /nobreak >nul
endlocal
