$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$runDirectory = Join-Path $root "var\run"
$maintenanceFlag = Join-Path $runDirectory "patap-auth-maintenance.flag"
$supervisorPidFile = Join-Path $runDirectory "patap-auth-supervisor.pid"
$backendPidFile = Join-Path $runDirectory "patap-auth-backend.pid"

New-Item -ItemType Directory -Path $runDirectory -Force | Out-Null
$marker = [PSCustomObject]@{
  enteredAt = [DateTime]::UtcNow.ToString("o")
  requestedByPid = $PID
  purpose = "controlled-release-maintenance"
} | ConvertTo-Json -Compress
Set-Content -LiteralPath $maintenanceFlag -Value $marker -Encoding utf8

function Get-PatapSupervisorProcesses {
  @(Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" -ErrorAction SilentlyContinue |
    Where-Object { [string]$_.CommandLine -like "*backend-supervisor.ps1*" })
}

function Get-PatapBackendProcesses {
  @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { [string]$_.CommandLine -like "*server*auth*server.js*" })
}

$supervisors = @(Get-PatapSupervisorProcesses)
foreach ($process in $supervisors) {
  Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop
}

$backends = @(Get-PatapBackendProcesses)
foreach ($process in $backends) {
  Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop
}

for ($attempt = 0; $attempt -lt 20; $attempt++) {
  if ((Get-PatapSupervisorProcesses).Count -eq 0 -and (Get-PatapBackendProcesses).Count -eq 0) { break }
  Start-Sleep -Milliseconds 250
}

$remainingSupervisors = @(Get-PatapSupervisorProcesses)
$remainingBackends = @(Get-PatapBackendProcesses)
if ($remainingSupervisors.Count -eq 0) {
  Remove-Item -LiteralPath $supervisorPidFile -Force -ErrorAction SilentlyContinue
}
if ($remainingBackends.Count -eq 0) {
  Remove-Item -LiteralPath $backendPidFile -Force -ErrorAction SilentlyContinue
}

$result = [PSCustomObject]@{
  MaintenanceMode = Test-Path -LiteralPath $maintenanceFlag
  SupervisorRunning = $remainingSupervisors.Count -gt 0
  BackendRunning = $remainingBackends.Count -gt 0
  SupervisorProcessesStopped = $supervisors.Count
  BackendProcessesStopped = $backends.Count
}
$result

if ($remainingSupervisors.Count -gt 0 -or $remainingBackends.Count -gt 0) {
  Write-Error "PATAP backend did not fully enter maintenance mode. Do not replace files or continue the release."
  exit 1
}
