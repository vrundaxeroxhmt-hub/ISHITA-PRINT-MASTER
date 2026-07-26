@echo off
setlocal
title ISHITA PRINT MASTER Launcher
cd /d "F:\DILIP PROJECTS\ISHITA-PRINT-MASTER"

echo Starting ISHITA PRINT MASTER Services...
echo.

echo [1/3] Starting Dashboard Dev Server (Port 8080)...
start "Dashboard Dev Server" powershell -NoExit -Command "Set-Location 'F:\DILIP PROJECTS\ISHITA-PRINT-MASTER'; $host.UI.RawUI.WindowTitle='Dashboard Dev Server'; try { npm run dev:web } catch { Write-Host $_ -ForegroundColor Red }"
timeout /t 2 /nobreak >nul

echo [2/3] Starting WhatsApp Gateway (Port 3001)...
start "WhatsApp Gateway" powershell -NoExit -Command "Set-Location 'F:\DILIP PROJECTS\ISHITA-PRINT-MASTER'; $host.UI.RawUI.WindowTitle='WhatsApp Gateway'; try { node backend\whatsapp-gateway.mjs } catch { Write-Host $_ -ForegroundColor Red }"
timeout /t 2 /nobreak >nul

echo [3/3] Starting ngrok Fixed Dev Domain Tunnel...
start "ngrok Tunnel" powershell -NoExit -Command "$host.UI.RawUI.WindowTitle='ngrok Tunnel'; try { ngrok http --domain=chatter-frighten-quotation.ngrok-free.dev 3001 } catch { Write-Host $_ -ForegroundColor Red }"

echo.
echo All services launched! Waiting 5 seconds before opening dashboard...
timeout /t 5 /nobreak >nul

echo Opening http://localhost:8080...
start "" "http://localhost:8080"

endlocal
exit
