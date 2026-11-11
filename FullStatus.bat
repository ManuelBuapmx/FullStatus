@echo off
rem PRISMAL MESH. Todos los derechos reservados.
rem FullStatus.bat: doble clic = baja la ultima version de GitHub y abre FullStatus (sin instalar).
rem Para compilar el instalador usa actualizar.ps1 sin -Probar.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0actualizar.ps1" -Probar
if errorlevel 1 pause
