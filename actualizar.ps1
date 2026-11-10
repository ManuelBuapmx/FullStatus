# PRISMAL MESH. Todos los derechos reservados.
# actualizar.ps1: actualiza FullStatus desde GitHub, lo compila y abre el instalador (Windows).
#
# Uso (PowerShell, dentro de la carpeta del proyecto):
#   powershell -ExecutionPolicy Bypass -File .\actualizar.ps1            # actualizar + compilar + abrir instalador
#   powershell -ExecutionPolicy Bypass -File .\actualizar.ps1 -Probar    # actualizar + abrir la app SIN instalar
#
# Requisitos: Git y Node.js instalados. Cierra FullStatus antes de instalar: el instalador lo pide.
param([switch]$Probar)
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host "1/4  Actualizando desde GitHub..." -ForegroundColor Cyan
git pull

Write-Host "2/4  Instalando dependencias..." -ForegroundColor Cyan
npm install

if ($Probar) {
  Write-Host "3/4  Abriendo FullStatus (modo prueba, sin instalar)..." -ForegroundColor Cyan
  npm run start:windows
  exit
}

Write-Host "3/4  Compilando el instalador de Windows..." -ForegroundColor Cyan
npm run dist:windows

Write-Host "4/4  Abriendo el instalador..." -ForegroundColor Cyan
$setup = Get-ChildItem -Path "dist" -Filter "FullStatus Setup *.exe" |
         Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $setup) { throw "No se encontró el instalador en la carpeta dist." }
Start-Process $setup.FullName
