@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0open-mainland-shadow.ps1"
if errorlevel 1 pause
