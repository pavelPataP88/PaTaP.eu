$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$supervisorScript = Join-Path $root "backend-supervisor.ps1"
$runDirectory = Join-Path $root "var\run"
$supervisorPidFile = Join-Path $runDirectory "patap-auth-supervisor.pid"
$maintenanceFlag = Join-Path $runDirectory "patap-auth-maintenance.flag"

if (-not (Test-Path -LiteralPath $supervisorScript)) {
  throw "Backend supervisor script not found: $supervisorScript"
}

if (Test-Path -LiteralPath $maintenanceFlag) {
  Write-Error "Backend maintenance mode is active. Use resume-backend.ps1 after the approved release action."
  exit 2
}

$existing = $null
if (Test-Path -LiteralPath $supervisorPidFile) {
  try {
    $supervisorPid = [int](Get-Content -LiteralPath $supervisorPidFile -Raw)
    $candidate = Get-Process -Id $supervisorPid -ErrorAction SilentlyContinue
    if ($candidate -and $candidate.ProcessName -eq "powershell") {
      $command = Get-CimInstance Win32_Process -Filter "ProcessId = $supervisorPid" -ErrorAction SilentlyContinue
      if ($command -and [string]$command.CommandLine -like "*backend-supervisor.ps1*") {
        $existing = $candidate
      }
    }
  } catch {
    $existing = $null
  }
}

if (-not $existing) {
  $logsDirectory = Join-Path $root "var\logs"
  New-Item -ItemType Directory -Path $logsDirectory -Force | Out-Null
  $pathValue = [Environment]::GetEnvironmentVariable("Path", "Process")
  [Environment]::SetEnvironmentVariable("PATH", $null, "Process")
  [Environment]::SetEnvironmentVariable("Path", $pathValue, "Process")
  Start-Process -FilePath "powershell.exe" `
    -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $supervisorScript) `
    -WorkingDirectory $root `
    -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $logsDirectory "patap-auth-supervisor.out.log") `
    -RedirectStandardError (Join-Path $logsDirectory "patap-auth-supervisor.err.log")
}

$health = $false
for ($attempt = 0; $attempt -lt 20 -and -not $health; $attempt++) {
  Start-Sleep -Milliseconds 500
  try {
    $response = Invoke-WebRequest -Uri "http://127.0.0.1:8091/api/health" -UseBasicParsing -TimeoutSec 2
    $health = $response.StatusCode -eq 200
  } catch {
    $health = $false
  }
}

$result = [PSCustomObject]@{
  MaintenanceMode = $false
  SupervisorRunning = [bool]$(if (Test-Path -LiteralPath $supervisorPidFile) {
    try {
      $supervisorPid = [int](Get-Content -LiteralPath $supervisorPidFile -Raw)
      Get-Process -Id $supervisorPid -ErrorAction SilentlyContinue
    } catch { $null }
  })
  BackendHealth = $health
}
$result

if (-not $health) {
  Write-Error "Backend did not become healthy. Inspect var\logs\patap-auth-supervisor.log and backend error logs; automatic restart may have been stopped by the crash-loop guard."
  exit 1
}
