$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$supervisorPidFile = Join-Path $root "var\run\patap-auth-supervisor.pid"
$backendPidFile = Join-Path $root "var\run\patap-auth-backend.pid"
$stopped = $false

if (Test-Path -LiteralPath $supervisorPidFile) {
  $supervisorPid = [int](Get-Content -LiteralPath $supervisorPidFile -Raw)
  $supervisor = Get-Process -Id $supervisorPid -ErrorAction SilentlyContinue
  if ($supervisor -and $supervisor.ProcessName -eq "powershell") {
    Stop-Process -Id $supervisorPid -Force
    Write-Host "Stopped Patap auth supervisor process $supervisorPid."
    $stopped = $true
  }
  Remove-Item -LiteralPath $supervisorPidFile -Force -ErrorAction SilentlyContinue
}

if ($stopped) {
  Start-Sleep -Milliseconds 300
}

if (Test-Path -LiteralPath $backendPidFile) {
  $backendPid = [int](Get-Content -LiteralPath $backendPidFile -Raw)
  $backend = Get-Process -Id $backendPid -ErrorAction SilentlyContinue
  if ($backend -and $backend.ProcessName -eq "node") {
    Stop-Process -Id $backendPid -Force
    Write-Host "Stopped Patap auth backend process $backendPid."
    $stopped = $true
  }
  Remove-Item -LiteralPath $backendPidFile -Force -ErrorAction SilentlyContinue
}

if (-not $stopped) {
  Write-Host "Patap auth backend is not running or its PID file is unavailable."
}
