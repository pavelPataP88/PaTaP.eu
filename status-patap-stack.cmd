@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0status-patap-stack.ps1"
exit /b %ERRORLEVEL%
