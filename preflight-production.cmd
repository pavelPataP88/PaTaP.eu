@echo off
cd /d "%~dp0"
call npm run production:preflight
exit /b %ERRORLEVEL%
