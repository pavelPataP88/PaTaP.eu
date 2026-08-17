@echo off
powershell.exe -ExecutionPolicy Bypass -Command "$target = Join-Path (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup') 'Patap Lab Stack.cmd'; if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Force; Write-Host 'Patap Lab autostart removed:' $target } else { Write-Host 'Patap Lab autostart is not installed.' }"
