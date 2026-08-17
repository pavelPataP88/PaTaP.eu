$ErrorActionPreference = "Stop"

$processes = Get-CimInstance Win32_Process -Filter "Name = 'cloudflared.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -like "*tunnel run*" -and $_.CommandLine -like "*patap-lab-token.txt*" }

if (-not $processes) {
  Write-Host "Patap Lab cloudflared tunnel is not running."
  exit 0
}

foreach ($process in $processes) {
  Stop-Process -Id $process.ProcessId -Force
  Write-Host "Stopped Patap Lab cloudflared process $($process.ProcessId)."
}
