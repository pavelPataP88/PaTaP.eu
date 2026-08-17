@echo off
powershell.exe -ExecutionPolicy Bypass -Command "$root = Split-Path -Parent '%~f0'; $startup = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup'; $target = Join-Path $startup 'Patap Lab Stack.cmd'; Copy-Item -LiteralPath (Join-Path $root 'start-patap-stack.cmd') -Destination $target -Force; Write-Host 'Patap Lab autostart installed:' $target"
