$ErrorActionPreference = "Stop"

$listeners = Get-NetTCPConnection -LocalPort 8090 -State Listen -ErrorAction SilentlyContinue
if (-not $listeners) {
  Write-Host "Origin on port 8090 is not running."
  exit 0
}

$processIds = $listeners | Select-Object -ExpandProperty OwningProcess -Unique
foreach ($processId in $processIds) {
  $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
  if ($process -and $process.ProcessName -eq "caddy") {
    Stop-Process -Id $processId -Force
    Write-Host "Stopped Caddy origin process $processId on port 8090."
  } else {
    Write-Host "Port 8090 is owned by non-Caddy process $processId. Not stopping it."
  }
}
