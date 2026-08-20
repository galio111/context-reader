@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0pull-mainland-backups.ps1"
if errorlevel 1 pause
