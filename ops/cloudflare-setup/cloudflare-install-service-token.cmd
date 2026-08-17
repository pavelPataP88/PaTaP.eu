@echo off
set TOKEN_FILE=%LOCALAPPDATA%\PatapLab\cloudflared\patap-lab-token.txt
if not exist "%TOKEN_FILE%" (
  echo Token file not found: %TOKEN_FILE%
  echo Run install from the active user profile first.
  exit /b 1
)
echo This legacy helper is intentionally disabled because cloudflared service install requires passing a token.
echo Current production startup uses user Startup folder and --token-file instead.
exit /b 1
