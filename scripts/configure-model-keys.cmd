@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0configure-model-keys.ps1" -ProjectRoot "%~dp0.."
pause
