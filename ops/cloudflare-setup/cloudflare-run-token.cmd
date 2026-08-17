@echo off
set TOKEN_FILE=%LOCALAPPDATA%\PatapLab\cloudflared\patap-lab-token.txt
if not exist "%TOKEN_FILE%" (
  echo Token file not found: %TOKEN_FILE%
  exit /b 1
)
"C:\Program Files (x86)\cloudflared\cloudflared.exe" tunnel run --token-file "%TOKEN_FILE%"
