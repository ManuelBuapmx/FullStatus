@echo off
set "APP_DIR=%~dp0"
cd /d "%APP_DIR%"
where node >nul 2>nul
if errorlevel 1 (
  echo No se encontro Node.js en el PATH.
  pause
  exit /b 1
)
start "FullStatus servidor" /min cmd /c "node server.cjs"
timeout /t 2 /nobreak >nul
start "" "http://localhost:5173"
