@echo off
setlocal
title ISHITA PRINT MASTER - Stop Services
cd /d "F:\DILIP PROJECTS\ISHITA-PRINT-MASTER"

echo ===================================================
echo   Stopping ISHITA PRINT MASTER Services...
echo ===================================================
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command "& {
    Write-Host '[1/3] Checking Dashboard Dev Server (Port 8080)...' -ForegroundColor Cyan
    $dashPids = Get-NetTCPConnection -LocalPort 8080 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique
    if ($dashPids) {
        foreach ($pidToKill in $dashPids) {
            try {
                Stop-Process -Id $pidToKill -Force -ErrorAction Stop
                Write-Host ('  - Stopped Dashboard process PID: ' + $pidToKill + ' on port 8080.') -ForegroundColor Green
            } catch {
                Write-Host ('  - Could not stop PID: ' + $pidToKill) -ForegroundColor Yellow
            }
        }
    } else {
        Write-Host '  - Dashboard Dev Server is not running on port 8080.' -ForegroundColor Gray
    }

    Write-Host '[2/3] Checking WhatsApp Gateway (Port 3001)...' -ForegroundColor Cyan
    $waPids = Get-NetTCPConnection -LocalPort 3001 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique
    $waCmdPids = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*whatsapp-gateway.mjs*' } | Select-Object -ExpandProperty ProcessId
    $allWaPids = @($waPids) + @($waCmdPids) | Select-Object -Unique
    if ($allWaPids) {
        foreach ($pidToKill in $allWaPids) {
            try {
                Stop-Process -Id $pidToKill -Force -ErrorAction Stop
                Write-Host ('  - Stopped WhatsApp Gateway process PID: ' + $pidToKill + '.') -ForegroundColor Green
            } catch {}
        }
    } else {
        Write-Host '  - WhatsApp Gateway is not running.' -ForegroundColor Gray
    }

    Write-Host '[3/3] Checking ngrok Tunnel (ngrok.exe)...' -ForegroundColor Cyan
    $ngrokProcs = Get-Process -Name 'ngrok' -ErrorAction SilentlyContinue
    if ($ngrokProcs) {
        foreach ($proc in $ngrokProcs) {
            try {
                Stop-Process -Id $proc.Id -Force -ErrorAction Stop
                Write-Host ('  - Stopped ngrok process PID: ' + $proc.Id + '.') -ForegroundColor Green
            } catch {
                Write-Host ('  - Could not stop ngrok PID: ' + $proc.Id) -ForegroundColor Yellow
            }
        }
    } else {
        Write-Host '  - ngrok Tunnel is not running.' -ForegroundColor Gray
    }
}"

echo.
echo ===================================================
echo   All ISHITA PRINT MASTER services stopped.
echo ===================================================
echo.
pause
