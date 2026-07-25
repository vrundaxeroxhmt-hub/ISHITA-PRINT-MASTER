@echo off
setlocal
set "SOURCE_DATA=%~dp0.whatsapp-data"
set "TARGET_DATA=%APPDATA%\PrintDesk\data"
set "INSTALLER=%~dp0PrintDesk Setup 1.0.0.exe"

if not exist "%INSTALLER%" (
  echo PrintDesk installer was not found beside this migration launcher.
  pause
  exit /b 1
)

if exist "%SOURCE_DATA%" if not exist "%TARGET_DATA%" (
  echo Migrating existing WhatsApp login, jobs and settings...
  xcopy "%SOURCE_DATA%" "%TARGET_DATA%\" /E /I /H /Y >nul
  if errorlevel 1 (
    echo Data migration failed. Installation was not started.
    pause
    exit /b 1
  )
)

echo Starting PrintDesk installer...
start "" "%INSTALLER%"
endlocal
