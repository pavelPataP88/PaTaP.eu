@echo off
set CADDY_EXE=C:\Users\Biuro\AppData\Local\Microsoft\WinGet\Packages\CaddyServer.Caddy_Microsoft.Winget.Source_8wekyb3d8bbwe\caddy.exe
"%CADDY_EXE%" run --config Caddyfile --adapter caddyfile
